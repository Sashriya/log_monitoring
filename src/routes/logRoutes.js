import { Router } from "express";
import { listLogs, tailLog } from "../controllers/logController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = Router();

router.use(protect);

router.get("/", listLogs);
router.get("/:fileName/tail", tailLog);

export default router;