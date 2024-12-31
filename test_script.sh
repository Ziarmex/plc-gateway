#!/bin/bash

# Script de test automatisé pour la passerelle PLC
# Usage: ./test_system.sh

set -e

echo "======================================"
echo "Test de la passerelle PLC → OPC UA"
echo "======================================"
echo ""

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Fonction de test
test_step() {
    local description=$1
    local command=$2
    
    echo -n "→ $description... "
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ ÉCHEC${NC}"
        return 1
    fi
}

# Fonction d'attente
wait_for_service() {
    local service=$1
    local timeout=$2
    local count=0
    
    echo -n "→ Attente du service $service... "
    
    while [ $count -lt $timeout ]; do
        if docker-compose ps | grep -q "$service.*Up"; then
            echo -e "${GREEN}✓ Démarré${NC}"
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    
    echo -e "${RED}✗ Timeout${NC}"
    return 1
}

echo "=== Phase 1: Vérification de l'environnement ==="
echo ""

test_step "Docker installé" "docker --version"
test_step "Docker Compose installé" "docker-compose --version"
test_step "Port 3000 disponible" "! nc -z localhost 3000"
test_step "Port 1880 disponible" "! nc -z localhost 1880"
test_step "Port 4840 disponible" "! nc -z localhost 4840"
test_step "Port 5020 disponible" "! nc -z localhost 5020"
test_step "Port 8086 disponible" "! nc -z localhost 8086"

echo ""
echo "=== Phase 2: Démarrage des services ==="
echo ""

echo "→ Arrêt des services existants..."
docker-compose down -v > /dev/null 2>&1 || true
echo -e "${GREEN}✓ OK${NC}"

echo "→ Construction des images..."
if docker-compose build > /tmp/build.log 2>&1; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ ÉCHEC${NC}"
    echo "Logs:"
    tail -20 /tmp/build.log
    exit 1
fi

echo "→ Démarrage des conteneurs..."
if docker-compose up -d > /tmp/start.log 2>&1; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ ÉCHEC${NC}"
    echo "Logs:"
    tail -20 /tmp/start.log
    exit 1
fi

# Attente du démarrage
wait_for_service "influxdb" 30
wait_for_service "modbus-simulator" 20
wait_for_service "plc-gateway" 30
wait_for_service "node-red" 20
wait_for_service "grafana" 30

echo ""
echo "=== Phase 3: Tests de connectivité ==="
echo ""

sleep 10  # Temps supplémentaire pour initialisation

test_step "Simulateur Modbus écoute" "nc -z localhost 5020"
test_step "Serveur OPC UA écoute" "nc -z localhost 4840"
test_step "Node-RED répond" "curl -s -o /dev/null -w '%{http_code}' http://localhost:1880 | grep -q 200"
test_step "Grafana répond" "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 | grep -q 200"
test_step "InfluxDB répond" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8086/health | grep -q 200"

echo ""
echo "=== Phase 4: Tests fonctionnels ==="
echo ""

# Test lecture Modbus
test_step "Lecture registres Modbus" "docker-compose exec -T modbus-simulator python3 -c \"
from pymodbus.client import ModbusTcpClient
client = ModbusTcpClient('localhost', port=5020)
client.connect()
result = client.read_holding_registers(0, 11, unit=1)
client.close()
exit(0 if result and len(result.registers) == 11 else 1)
\""

# Test logs gateway
test_step "Gateway convertit les données" "docker-compose logs plc-gateway | grep -q 'Données Modbus lues'"

# Test écriture InfluxDB
sleep 5  # Attendre l'écriture des données
test_step "Données dans InfluxDB" "docker-compose exec -T influxdb influx query 'from(bucket:\"plc-data\") |> range(start:-1m) |> filter(fn:(r) => r._measurement == \"motor\")' --org plc-org --token my-super-secret-auth-token | grep -q motor"

# Test dashboard Grafana
test_step "Dashboard Grafana existe" "curl -s -u admin:admin http://localhost:3000/api/dashboards/uid/plc-monitoring | grep -q '\"title\":\"PLC Monitoring Dashboard\"'"

echo ""
echo "=== Phase 5: Tests de performance ==="
echo ""

# Test fréquence de mise à jour
echo -n "→ Test fréquence de lecture (10s)... "
BEFORE=$(docker-compose logs plc-gateway | grep -c "Données Modbus lues" || echo 0)
sleep 10
AFTER=$(docker-compose logs plc-gateway | grep -c "Données Modbus lues" || echo 0)
DIFF=$((AFTER - BEFORE))

if [ $DIFF -ge 8 ] && [ $DIFF -le 12 ]; then
    echo -e "${GREEN}✓ OK ($DIFF lectures)${NC}"
else
    echo -e "${YELLOW}⚠ Attention ($DIFF lectures, attendu 8-12)${NC}"
fi

# Test latence
echo -n "→ Test latence de conversion... "
START=$(date +%s%N)
docker-compose exec -T modbus-simulator python3 -c "
from pymodbus.client import ModbusTcpClient
client = ModbusTcpClient('localhost', port=5020)
client.connect()
result = client.read_holding_registers(0, 1, unit=1)
client.close()
" > /dev/null 2>&1
END=$(date +%s%N)
LATENCY=$(( (END - START) / 1000000 ))  # en ms

if [ $LATENCY -lt 500 ]; then
    echo -e "${GREEN}✓ OK (${LATENCY}ms)${NC}"
else
    echo -e "${YELLOW}⚠ Lent (${LATENCY}ms)${NC}"
fi

echo ""
echo "=== Phase 6: Vérification des logs ==="
echo ""

test_step "Aucune erreur simulateur" "! docker-compose logs modbus-simulator | grep -i error | grep -v 'CRITICAL: Temperature'"
test_step "Aucune erreur gateway" "! docker-compose logs plc-gateway | grep -i 'Erreur fatale'"
test_step "Aucune erreur Node-RED" "! docker-compose logs node-red | grep -E 'ERROR|FATAL'"

echo ""
echo "=== Résumé des tests ==="
echo ""

# Affichage des URLs
echo -e "${GREEN}Services accessibles:${NC}"
echo "  → Grafana:     http://localhost:3000 (admin/admin)"
echo "  → Node-RED:    http://localhost:1880"
echo "  → InfluxDB:    http://localhost:8086 (admin/adminpassword)"
echo "  → OPC UA:      opc.tcp://localhost:4840/UA/PLCGateway"
echo "  → Modbus:      localhost:5020"
echo ""

# Statistiques
echo -e "${GREEN}Statistiques:${NC}"
echo "  → Conteneurs actifs: $(docker-compose ps | grep -c Up)"
echo "  → Uptime gateway: $(docker-compose ps | grep plc-gateway | awk '{print $5, $6}')"
echo "  → Mémoire totale: $(docker stats --no-stream --format 'table {{.MemUsage}}' | tail -n +2 | awk '{sum+=$1} END {print sum}') MB (approx)"
echo ""

# Logs récents
echo -e "${YELLOW}Dernières entrées de logs:${NC}"
echo "--- Simulateur ---"
docker-compose logs --tail=3 modbus-simulator | sed 's/^/  /'
echo "--- Gateway ---"
docker-compose logs --tail=3 plc-gateway | sed 's/^/  /'
echo ""

echo "======================================"
echo -e "${GREEN}✓ Tests terminés avec succès !${NC}"
echo "======================================"
echo ""
echo "Pour arrêter les services:"
echo "  docker-compose down"
echo ""
echo "Pour voir les logs en temps réel:"
echo "  docker-compose logs -f"
echo ""

exit 0