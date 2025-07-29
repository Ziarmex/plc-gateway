#!/usr/bin/env python3
"""
Simulateur Modbus TCP - Simule un PLC industriel
Génère des données réalistes pour: moteurs, capteurs, états machines
"""

import os
import time
import math
import random
import logging
from datetime import datetime
from pymodbus.server import StartTcpServer
from pymodbus.device import ModbusDeviceIdentification
from pymodbus.datastore import ModbusSequentialDataBlock, ModbusSlaveContext, ModbusServerContext

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/app/logs/modbus_simulator.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class PLCSimulator:
    """Simulateur PLC avec génération de données réalistes"""
    
    def __init__(self):
        self.running = True
        self.cycle_count = 0
        
        # Paramètres de simulation
        self.motor_speed_base = 1500  # RPM nominal
        self.motor_speed_variation = 100
        self.temperature_base = 65.0  # °C
        self.pressure_base = 5.5  # Bar
        self.vibration_base = 0.5  # mm/s
        
        # États machines (0=Arrêt, 1=Démarrage, 2=Fonctionnement, 3=Alarme)
        self.machine_state = 2
        self.alarm_probability = 0.02  # 2% chance d'alarme
        
    def update_values(self, context):
        """Mise à jour cyclique des valeurs Modbus"""
        self.cycle_count += 1
        
        try:
            # Calcul des valeurs simulées avec variation temporelle
            t = time.time()
            
            # Vitesse moteur (registres 0-1: RPM en 16 bits)
            motor_speed = int(
                self.motor_speed_base + 
                self.motor_speed_variation * math.sin(t / 10) +
                random.uniform(-20, 20)
            )
            motor_speed = max(0, min(3000, motor_speed))
            
            # Température (registre 2: en dixièmes de °C)
            temperature = int(
                (self.temperature_base + 
                 5 * math.sin(t / 30) + 
                 random.uniform(-1, 1)) * 10
            )
            
            # Pression (registre 3: en centièmes de Bar)
            pressure = int(
                (self.pressure_base + 
                 0.5 * math.sin(t / 20) + 
                 random.uniform(-0.1, 0.1)) * 100
            )
            
            # Vibration (registre 4: en centièmes de mm/s)
            vibration = int(
                (self.vibration_base + 
                 0.2 * math.sin(t / 15) + 
                 random.uniform(-0.05, 0.05)) * 100
            )
            
            # Courant moteur (registre 5: en dixièmes d'Ampères)
            current = int((motor_speed / 150 + random.uniform(-0.5, 0.5)) * 10)
            
            # Production compteur (registres 6-7: compteur 32 bits)
            production_count = self.cycle_count * 10
            production_high = (production_count >> 16) & 0xFFFF
            production_low = production_count & 0xFFFF
            
            # État machine et alarmes (registre 8)
            if random.random() < self.alarm_probability:
                self.machine_state = 3  # Alarme
            elif self.machine_state == 3 and random.random() < 0.3:
                self.machine_state = 2  # Retour au fonctionnement
            
            # Bits d'état (registre 9)
            status_bits = 0
            status_bits |= (1 << 0) if motor_speed > 500 else 0  # Moteur ON
            status_bits |= (1 << 1) if temperature > 700 else 0  # Température haute
            status_bits |= (1 << 2) if pressure > 600 else 0     # Pression haute
            status_bits |= (1 << 3) if self.machine_state == 3 else 0  # Alarme
            status_bits |= (1 << 4) if vibration > 60 else 0     # Vibration haute
            
            # Qualité produit (registre 10: 0-100%)
            quality = int(95 + random.uniform(-3, 2))
            quality = max(0, min(100, quality))
            
            # Mise à jour du contexte Modbus
            slave_id = 0x01
            register_values = [
                motor_speed,        # 0: Vitesse moteur (RPM)
                0,                  # 1: Réservé
                temperature,        # 2: Température (0.1°C)
                pressure,           # 3: Pression (0.01 Bar)
                vibration,          # 4: Vibration (0.01 mm/s)
                current,            # 5: Courant (0.1 A)
                production_high,    # 6: Production High Word
                production_low,     # 7: Production Low Word
                self.machine_state, # 8: État machine
                status_bits,        # 9: Bits d'état
                quality,            # 10: Qualité (%)
            ]
            
            # Écriture dans les holding registers
            context[slave_id].setValues(3, 0, register_values)
            
            # Log périodique
            if self.cycle_count % 10 == 0:
                logger.info(
                    f"Cycle {self.cycle_count} - "
                    f"Vitesse: {motor_speed} RPM, "
                    f"Temp: {temperature/10:.1f}°C, "
                    f"Pression: {pressure/100:.2f} Bar, "
                    f"État: {self.machine_state}"
                )
                
        except Exception as e:
            logger.error(f"Erreur mise à jour valeurs: {e}")

def run_simulator():
    """Lance le serveur Modbus avec simulation"""
    
    # Configuration
    port = int(os.getenv('MODBUS_PORT', 5020))
    update_interval = int(os.getenv('UPDATE_INTERVAL', 1))
    
    logger.info(f"Démarrage simulateur Modbus sur port {port}")
    
    # Création du datastore
    store = ModbusSlaveContext(
        di=ModbusSequentialDataBlock(0, [0]*100),  # Discrete Inputs
        co=ModbusSequentialDataBlock(0, [0]*100),  # Coils
        hr=ModbusSequentialDataBlock(0, [0]*100),  # Holding Registers
        ir=ModbusSequentialDataBlock(0, [0]*100)   # Input Registers
    )
    context = ModbusServerContext(slaves=store, single=True)
    
    # Identification du device
    identity = ModbusDeviceIdentification()
    identity.VendorName = 'PLC Simulator'
    identity.ProductCode = 'PLC-SIM-001'
    identity.VendorUrl = 'http://github.com/plc-simulator'
    identity.ProductName = 'Industrial PLC Simulator'
    identity.ModelName = 'Virtual PLC v1.0'
    identity.MajorMinorRevision = '1.0.0'
    
    # Création du simulateur
    simulator = PLCSimulator()
    
    # Fonction de mise à jour périodique
    def updating_writer(a):
        """Callback pour mise à jour périodique des valeurs"""
        import threading
        while True:
            simulator.update_values(context)
            time.sleep(update_interval)
    
    # Démarrage du thread de mise à jour
    import threading
    update_thread = threading.Thread(target=updating_writer, args=(context,))
    update_thread.daemon = True
    update_thread.start()
    
    logger.info("Simulateur PLC démarré avec succès")
    logger.info(f"Registres disponibles: 0-10 (Holding Registers)")
    logger.info(f"Intervalle de mise à jour: {update_interval}s")
    
    # Démarrage du serveur
    StartTcpServer(
        context=context,
        identity=identity,
        address=("0.0.0.0", port)
    )

if __name__ == "__main__":
    # Création du dossier logs si nécessaire
    os.makedirs('/app/logs', exist_ok=True)
    
    try:
        run_simulator()
    except KeyboardInterrupt:
        logger.info("Arrêt du simulateur")
    except Exception as e:
        logger.error(f"Erreur fatale: {e}")
        raise