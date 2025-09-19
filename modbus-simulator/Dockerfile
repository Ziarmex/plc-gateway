FROM python:3.11-slim

WORKDIR /app

# Installation des dépendances système
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Installation des bibliothèques Python
RUN pip install --no-cache-dir \
    pymodbus==3.5.2 \
    pyserial==3.5

# Copie du code
COPY simulator.py /app/
COPY requirements.txt /app/

# Création des dossiers
RUN mkdir -p /app/logs

# Exposition du port Modbus
EXPOSE 5020

# Commande de démarrage
CMD ["python", "-u", "simulator.py"]