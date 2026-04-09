import { configManager } from './config';
import { Server } from './server';

// Load configuration
configManager.load();

// Create and start server
const server = new Server();
server.start();