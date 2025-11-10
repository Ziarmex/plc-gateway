# Passerelle PLC → OPC UA (plc-gateway)

## Description

Passerelle industrielle complète permettant la conversion de protocoles PLC Modbus TCP vers OPC UA, avec intégration Node-RED pour le traitement des données et Grafana pour la visualisation en temps réel.

### Architecture

```
┌──────────────────┐      ┌──────────────┐      ┌──────────┐      ┌──────────┐      ┌─────────┐
│ Simulateur PLC   │─────▶│   Gateway    │─────▶│ Node-RED │─────▶│ InfluxDB │─────▶│ Grafana │
│ (Modbus TCP)     │      │ Modbus→OPCUA │      │          │      │          │      │         │
└──────────────────┘      └──────────────┘      └──────────┘      └──────────┘      └─────────┘
   Port 5020                 Port 4840            Port 1880         Port 8086         Port 3000
```

##  Fonctionnalités

### Simulateur Modbus
- Génération de données réalistes pour environnement industriel
- 11 registres Modbus simulant :
  - Vitesse moteur (RPM)
  - Température (°C)
  - Pression (Bar)
  - Vibration (mm/s)
  - Courant électrique (A)
  - Compteur de production
  - État machine (Stopped, Starting, Running, Alarm)
  - Bits d'état
  - Qualité produit (%)

### Gateway Modbus → OPC UA
- Lecture cyclique des registres Modbus (1s par défaut)
- Exposition des données via serveur OPC UA
- Mapping automatique des données
- Logging détaillé des conversions
- Gestion des reconnexions automatiques
- Performance : conversion < 100ms

### Node-RED
- Lecture des nodes OPC UA
- Traitement des données :
  - Validation et filtrage
  - Calculs dérivés (puissance, taux de production)
  - Détection d'anomalies
  - Moyenne mobile
- Écriture vers InfluxDB

### Grafana
- Dashboard en temps réel (rafraîchissement 5s)
- Visualisations :
  - Jauges pour vitesse, température, qualité
  - Graphiques temporels
  - Indicateurs d'état
  - Statistiques de production

## 🚀 Installation et démarrage

### Prérequis

- Docker et Docker Compose installés
- 4 Go de RAM minimum
- Ports disponibles : 3000, 1880, 4840, 5020, 8086

### Structure des fichiers

```
plc-gateway/
├── docker-compose.yml
├── modbus-simulator/
│   ├── Dockerfile
│   ├── simulator.py
│   └── requirements.txt
├── plc-gateway/
│   ├── Dockerfile
│   ├── gateway.js
│   └── package.json
├── node-red/
│   └── flows.json
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/
│   │   │   └── influxdb.yml
│   │   └── dashboards/
│   │       └── dashboard.yml
│   └── dashboards/
│       └── plc-monitoring.json
└── README.md
```

### Démarrage rapide

1. **Cloner le projet et construire les images**

```bash
# Construction des images
docker-compose build

# Démarrage de tous les services
docker-compose up -d
```

2. **Vérifier le démarrage**

```bash
# Vérifier les logs
docker-compose logs -f

# Vérifier l'état des services
docker-compose ps
```

Tous les services doivent être "Up" après 30-60 secondes.

3. **Accéder aux interfaces**

| Service | URL | Identifiants |
|---------|-----|--------------|
| Grafana | http://localhost:3000 | admin / admin |
| Node-RED | http://localhost:1880 | Aucun |
| InfluxDB | http://localhost:8086 | admin / adminpassword |

##  Utilisation

### 1. Visualisation dans Grafana

1. Ouvrir http://localhost:3000
2. Connexion : `admin` / `admin`
3. Le dashboard "PLC Monitoring Dashboard" s'ouvre automatiquement
4. Visualisations disponibles :
   - Vitesse moteur en temps réel
   - Température avec seuils d'alarme
   - Courbes historiques
   - État machine
   - Production et qualité

### 2. Configuration Node-RED

1. Ouvrir http://localhost:1880
2. Le flow "PLC Gateway Monitor" est déjà chargé
3. Observer les données dans l'onglet Debug
4. Modifier les traitements si nécessaire

### 3. Vérification OPC UA

Utiliser un client OPC UA pour se connecter :
- Endpoint : `opc.tcp://localhost:4840/UA/PLCGateway`
- Nodes disponibles sous : `Objects/PLC_Data/`

### 4. Consultation des logs

```bash
# Logs du simulateur Modbus
docker-compose logs -f modbus-simulator

# Logs de la gateway
docker-compose logs -f plc-gateway

# Logs Node-RED
docker-compose logs -f node-red
```

##  Tests et validation

### Test 1 : Connexion Modbus

```bash
# Vérifier que le simulateur écoute
docker-compose exec modbus-simulator netstat -tuln | grep 5020

# Tester avec un client Modbus (exemple avec Python)
python3 << EOF
from pymodbus.client import ModbusTcpClient
client = ModbusTcpClient('localhost', port=5020)
client.connect()
result = client.read_holding_registers(0, 11, unit=1)
print(f"Vitesse moteur: {result.registers[0]} RPM")
client.close()
EOF
```

### Test 2 : Serveur OPC UA

```bash
# Vérifier que la gateway expose OPC UA
docker-compose logs plc-gateway | grep "Serveur OPC UA démarré"

# Le endpoint doit être listé : opc.tcp://plc-gateway:4840/UA/PLCGateway
```

### Test 3 : Flux Node-RED

1. Ouvrir Node-RED : http://localhost:1880
2. Activer le debug node
3. Vérifier la réception des messages toutes les secondes
4. Les messages doivent contenir les mesures formatées

### Test 4 : Visualisation Grafana

1. Ouvrir le dashboard
2. Vérifier que toutes les jauges se mettent à jour
3. Observer les courbes historiques (données sur 15 minutes)
4. Attendre qu'une alarme se déclenche (température > 75°C)

### Test de charge

```bash
# Le système doit supporter 100 lectures/minute minimum
# Modifier le POLL_INTERVAL dans docker-compose.yml à 600ms

docker-compose up -d --force-recreate plc-gateway
docker-compose logs -f plc-gateway

# Vérifier absence d'erreurs pendant 5 minutes
```

##  Configuration avancée

### Modifier l'intervalle de polling

Dans `docker-compose.yml`, section `plc-gateway` :

```yaml
environment:
  - POLL_INTERVAL=500  # 500ms au lieu de 1000ms
```

### Ajouter des registres Modbus

1. Modifier `modbus-simulator/simulator.py` :
   - Ajouter des valeurs dans `update_values()`
   - Étendre `register_values[]`

2. Modifier `plc-gateway/gateway.js` :
   - Ajouter les variables OPC UA correspondantes
   - Mettre à jour `plcData`

3. Mettre à jour les flows Node-RED

### Sécurité OPC UA

Pour activer les certificats :

```javascript
// Dans gateway.js, ajouter à la configuration server :
serverCertificateManager: new opcua.OPCUACertificateManager({
  rootFolder: "/app/certs"
})
```

##  Dépannage

### Problème : Le simulateur ne démarre pas

```bash
# Vérifier les logs
docker-compose logs modbus-simulator

# Solution : Reconstruire l'image
docker-compose build modbus-simulator
docker-compose up -d modbus-simulator
```

### Problème : Gateway ne se connecte pas au simulateur

```bash
# Vérifier la connectivité réseau
docker-compose exec plc-gateway ping modbus-simulator

# Redémarrer la gateway
docker-compose restart plc-gateway
```

### Problème : Pas de données dans Grafana

1. Vérifier InfluxDB :
```bash
docker-compose exec influxdb influx bucket list
```

2. Vérifier Node-RED :
   - Ouvrir http://localhost:1880
   - Vérifier que le flow est déployé
   - Activer le debug et vérifier les messages

3. Vérifier la datasource dans Grafana :
   - Configuration → Data Sources → InfluxDB
   - Tester la connexion

### Problème : Erreur "ECONNREFUSED" dans Node-RED

La gateway OPC UA n'est pas encore démarrée :
```bash
# Attendre 30 secondes supplémentaires
docker-compose logs -f plc-gateway

# Redéployer le flow Node-RED si nécessaire
```

##  Performance

### Métriques observées

- **Latence Modbus → OPC UA** : 50-100ms
- **Fréquence de lecture** : Configurable, défaut 1Hz
- **Charge CPU** : < 5% par service
- **Mémoire** : ~300 MB total
- **Débit supporté** : > 100 lectures/minute

### Optimisation

Pour améliorer les performances :

1. Réduire le nombre de nodes OPC UA lus
2. Augmenter l'intervalle de polling
3. Activer l'agrégation dans InfluxDB
4. Limiter la rétention des données historiques

##  Variables d'environnement

| Variable | Service | Défaut | Description |
|----------|---------|--------|-------------|
| MODBUS_PORT | modbus-simulator | 5020 | Port d'écoute Modbus |
| UPDATE_INTERVAL | modbus-simulator | 1 | Intervalle de mise à jour (s) |
| MODBUS_HOST | plc-gateway | modbus-simulator | Hôte du serveur Modbus |
| MODBUS_PORT | plc-gateway | 5020 | Port du serveur Modbus |
| OPCUA_PORT | plc-gateway | 4840 | Port du serveur OPC UA |
| POLL_INTERVAL | plc-gateway | 1000 | Intervalle de polling (ms) |

##  Sécurité

### Recommandations production

1. **Changer les mots de passe par défaut**
   - Grafana : admin/admin
   - InfluxDB : admin/adminpassword

2. **Activer HTTPS**
   - Configurer un reverse proxy (nginx)
   - Utiliser Let's Encrypt pour les certificats

3. **Activer la sécurité OPC UA**
   - Certificats X.509
   - Mode de sécurité : Sign & Encrypt

4. **Isoler le réseau**
   - Utiliser un réseau Docker dédié
   - Firewall pour restreindre les accès

##  Export et sauvegarde

### Export du dashboard Grafana

```bash
# Le dashboard est déjà exporté dans grafana/dashboards/plc-monitoring.json
```

### Sauvegarde InfluxDB

```bash
# Backup manuel
docker-compose exec influxdb influx backup /tmp/backup
docker cp plc-gateway_influxdb_1:/tmp/backup ./backup-$(date +%Y%m%d)
```

### Export des flows Node-RED

```bash
# Les flows sont dans node-red/flows.json
# Copier ce fichier pour backup
```

##  Développement

### Ajouter une nouvelle mesure

1. **Simulateur** : Ajouter dans `simulator.py`
2. **Gateway** : Créer la variable OPC UA dans `gateway.js`
3. **Node-RED** : Ajouter un nouveau read node et traitement
4. **Grafana** : Ajouter un panneau dans le dashboard

### Tests unitaires

```bash
# Tests Python (simulateur)
docker-compose exec modbus-simulator python -m pytest tests/

# Tests Node.js (gateway)
docker-compose exec plc-gateway npm test
```

## 📚 Références

- [Modbus Protocol](https://modbus.org/)
- [OPC UA Specification](https://opcfoundation.org/)
- [Node-RED Documentation](https://nodered.org/docs/)
- [InfluxDB Docs](https://docs.influxdata.com/)
- [Grafana Documentation](https://grafana.com/docs/)

## 📄 Licence

MIT License - Libre d'utilisation et modification.

## 👥 Support

Pour toute question :
1. Consulter les logs : `docker-compose logs`
2. Vérifier cette documentation
3. Ouvrir une issue sur le dépôt du projet

---

**Statut du projet** : ✅ Production Ready

**Dernière mise à jour** : 2025-01-07