import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gamesRouter from "./games";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gamesRouter);

export default router;
