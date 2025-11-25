FROM nodered/node-red:latest

RUN npm install \
    node-red-contrib-opcua@0.2.352 \
    node-red-contrib-influxdb@0.7.0

COPY flows.json /data/flows.json
COPY flows_credentials.json /data/flows_credentials.json
COPY settings.js /data/settings.js
