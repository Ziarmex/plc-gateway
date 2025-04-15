FROM node:18-slim

WORKDIR /app

# Installation des dépendances système
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copie des fichiers de configuration npm
COPY package.json /app/

# Installation des dépendances Node.js
RUN npm install

# Copie du code
COPY gateway.js /app/

# Création des dossiers
RUN mkdir -p /app/logs /app/certs

# Exposition du port OPC UA
EXPOSE 4840

# Commande de démarrage
CMD ["node", "gateway.js"]