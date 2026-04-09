"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const server_1 = require("./server");
// Load configuration
config_1.configManager.load();
// Create and start server
const server = new server_1.Server();
server.start();
