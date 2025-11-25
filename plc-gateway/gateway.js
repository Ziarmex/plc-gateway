/**
 * Passerelle PLC : conversion Modbus TCP vers OPC UA
 * Lit les registres Modbus et les expose via un serveur OPC UA
 */

const opcua = require("node-opcua");
const ModbusRTU = require("modbus-serial");
const fs = require("fs");
const path = require("path");
const winston = require("winston");

// Configuration du journal
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "/app/logs/gateway-error.log", level: "error" }),
    new winston.transports.File({ filename: "/app/logs/gateway.log" }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Configuration
const config = {
  modbus: {
    host: process.env.MODBUS_HOST || "plc-modbus-simulator",
    port: parseInt(process.env.MODBUS_PORT) || 5020,
    unitId: 1,
    timeout: 5000,
    retryDelay: 3000
  },
  opcua: {
    port: parseInt(process.env.OPCUA_PORT) || 4840,
    endpoint: "/UA/PLCGateway"
  },
  polling: {
    interval: parseInt(process.env.POLL_INTERVAL) || 1000
  }
};

// Client Modbus
const modbusClient = new ModbusRTU();
let isModbusConnected = false;

// Variables pour stocker les données
let plcData = {
  motorSpeed: 0,
  temperature: 0,
  pressure: 0,
  vibration: 0,
  current: 0,
  productionCount: 0,
  machineState: 0,
  statusBits: 0,
  quality: 0,
  lastUpdate: new Date()
};

// États de machine
const MachineStates = {
  0: "Arrêt",
  1: "Démarrage",
  2: "Fonctionnement",
  3: "Alarme"
};

/**
 * Connexion au serveur Modbus
 */
async function connectModbus() {
  try {
    logger.info(`Connexion au serveur Modbus : ${config.modbus.host}:${config.modbus.port}`);

    await modbusClient.connectTCP(config.modbus.host, {
      port: config.modbus.port
    });

    modbusClient.setID(config.modbus.unitId);
    modbusClient.setTimeout(config.modbus.timeout);

    isModbusConnected = true;
    logger.info("Connexion Modbus établie avec succès");

  } catch (error) {
    isModbusConnected = false;
    logger.error(`Erreur de connexion Modbus : ${error.message}`);

    // Nouvelle tentative après un délai
    setTimeout(connectModbus, config.modbus.retryDelay);
  }
}

/**
 * Lecture des registres Modbus
 */
async function readModbusData() {
  if (!isModbusConnected) {
    return;
  }

  try {
    // Lecture des 11 registres de maintien (0-10)
    const data = await modbusClient.readHoldingRegisters(0, 11);

    // Extraction et conversion des données
    plcData.motorSpeed = data.data[0]; // tr/min
    plcData.temperature = data.data[2] / 10; // °C
    plcData.pressure = data.data[3] / 100; // Bar
    plcData.vibration = data.data[4] / 100; // mm/s
    plcData.current = data.data[5] / 10; // A

    // Compteur de production (32 bits)
    plcData.productionCount = (data.data[6] << 16) | data.data[7];

    plcData.machineState = data.data[8];
    plcData.statusBits = data.data[9];
    plcData.quality = data.data[10]; // %
    plcData.lastUpdate = new Date();

    // Journalisation périodique
    if (Date.now() % 10000 < config.polling.interval) {
      logger.info(`Données Modbus lues : Vitesse=${plcData.motorSpeed} tr/min, Temp=${plcData.temperature.toFixed(1)}°C, État=${MachineStates[plcData.machineState]}`);
    }

    return plcData;

  } catch (error) {
    logger.error(`Erreur de lecture Modbus : ${error.message}`);
    isModbusConnected = false;
    modbusClient.close(() => {});
    setTimeout(connectModbus, config.modbus.retryDelay);
  }
}

/**
 * Création du serveur OPC UA
 */
async function createOPCUAServer() {
  logger.info("Initialisation du serveur OPC UA...");

  // Création du serveur
  const server = new opcua.OPCUAServer({
    port: config.opcua.port,
    resourcePath: config.opcua.endpoint,
    buildInfo: {
      productName: "Passerelle PLC",
      buildNumber: "1.0.0",
      buildDate: new Date()
    },
    applicationName: { text: "Passerelle PLC vers OPC UA" },
    applicationUri: "urn:PLCGateway",
    productUri: "urn:PLCGateway"
  });

  await server.initialize();
  logger.info("Serveur OPC UA initialisé");

  // Construction de l'espace d'adressage
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();

  // Création du dossier racine PLC
  const plcFolder = namespace.addFolder(addressSpace.rootFolder.objects, {
    browseName: "PLC_Data",
    displayName: "Données PLC"
  });

  // Variables pour les mesures
  const motorSpeedVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=MotorSpeed",
    browseName: "MotorSpeed",
    displayName: "Vitesse moteur",
    dataType: "Double",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: plcData.motorSpeed })
    }
  });

  const temperatureVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=Temperature",
    browseName: "Temperature",
    displayName: "Température",
    dataType: "Double",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: plcData.temperature })
    }
  });

  const pressureVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=Pressure",
    browseName: "Pressure",
    displayName: "Pression",
    dataType: "Double",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: plcData.pressure })
    }
  });

  const vibrationVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=Vibration",
    browseName: "Vibration",
    displayName: "Vibration",
    dataType: "Double",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: plcData.vibration })
    }
  });

  const currentVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=Current",
    browseName: "Current",
    displayName: "Courant",
    dataType: "Double",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: plcData.current })
    }
  });

  const productionVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=ProductionCount",
    browseName: "ProductionCount",
    displayName: "Compteur de production",
    dataType: "UInt32",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.UInt32, value: plcData.productionCount })
    }
  });

  const machineStateVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=MachineState",
    browseName: "MachineState",
    displayName: "État machine",
    dataType: "String",
    value: {
      get: () => new opcua.Variant({
        dataType: opcua.DataType.String,
        value: MachineStates[plcData.machineState] || "Inconnu"
      })
    }
  });

  const qualityVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=Quality",
    browseName: "Quality",
    displayName: "Qualité",
    dataType: "Double",
    value: {
      get: () => new opcua.Variant({ dataType: opcua.DataType.Double, value: plcData.quality })
    }
  });

  // Variables booléennes pour les bits d'état
  const motorOnVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=MotorOn",
    browseName: "MotorOn",
    displayName: "Moteur en marche",
    dataType: "Boolean",
    value: {
      get: () => new opcua.Variant({
        dataType: opcua.DataType.Boolean,
        value: (plcData.statusBits & 0x01) !== 0
      })
    }
  });

  const alarmActiveVar = namespace.addVariable({
    componentOf: plcFolder,
    nodeId: "ns=1;s=AlarmActive",
    browseName: "AlarmActive",
    displayName: "Alarme active",
    dataType: "Boolean",
    value: {
      get: () => new opcua.Variant({
        dataType: opcua.DataType.Boolean,
        value: (plcData.statusBits & 0x08) !== 0
      })
    }
  });

  logger.info("Espace d'adressage OPC UA créé");

  // Démarrage du serveur
  await server.start();

  const endpointUrl = server.getEndpointUrl();
  logger.info(`Serveur OPC UA démarré : ${endpointUrl}`);

  return server;
}

/**
 * Fonction principale
 */
async function main() {
  try {
    // Création des dossiers nécessaires
    fs.mkdirSync("/app/logs", { recursive: true });
    fs.mkdirSync("/app/certs", { recursive: true });

    logger.info("=== Démarrage de la passerelle PLC ===");
    logger.info(`Configuration : Modbus=${config.modbus.host}:${config.modbus.port}, OPC UA=:${config.opcua.port}`);

    // Connexion Modbus
    await connectModbus();

    // Création du serveur OPC UA
    const opcuaServer = await createOPCUAServer();

    // Interrogation périodique des données Modbus
    setInterval(readModbusData, config.polling.interval);

    logger.info("=== Passerelle opérationnelle ===");

    // Gestion de l'arrêt propre
    process.on("SIGINT", async () => {
      logger.info("Arrêt de la passerelle...");

      modbusClient.close(() => {});
      await opcuaServer.shutdown();

      logger.info("Passerelle arrêtée");
      process.exit(0);
    });

  } catch (error) {
    logger.error(`Erreur fatale : ${error.message}`);
    process.exit(1);
  }
}

// Démarrage
main();
