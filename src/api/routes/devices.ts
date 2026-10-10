import { Router, Request, Response } from 'express';
import { getCollections } from '../../db/mongo.js';

export const devicesRouter = Router();

devicesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { deviceRegistry } = await getCollections();
    const devices = await deviceRegistry.find({}).sort({ _id: 1 }).toArray();

    // Map to clean format
    const formatted = devices.map(d => ({
      deviceId: String(d._id),
      facilityId: d.facilityId || 'facility-central',
      model: d.model || 'model-alpha',
      firmware: d.firmware || 'v1.0',
      status: d.status || 'online',
      lastSeen: d.lastSeen || new Date(),
      batteryPct: typeof d.batteryPct === 'number' ? d.batteryPct : 92
    }));

    return res.status(200).json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});
