"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv = __importStar(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const services_1 = __importDefault(require("./routes/services"));
const availability_1 = __importDefault(require("./routes/availability"));
const bookings_1 = __importDefault(require("./routes/bookings"));
const billing_1 = __importStar(require("./routes/billing"));
dotenv.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
}));
// Webhook must receive raw body — register before express.json()
app.post('/api/billing/webhook', express_1.default.raw({ type: 'application/json' }), billing_1.webhookHandler);
app.use(express_1.default.json());
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/auth', auth_1.default);
app.use('/api/services', services_1.default);
app.use('/api/availability', availability_1.default);
app.use('/api/bookings', bookings_1.default);
app.use('/api/billing', billing_1.default);
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong' });
});
app.listen(PORT, () => {
    console.log(`🚀 Schedully API running on port ${PORT}`);
});
exports.default = app;
