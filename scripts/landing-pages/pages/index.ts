import type { FunnelSpec } from "../kit.ts";
import { spec as agenticEn } from "./ai-agentic-automation-en.ts";
import { GENERATED } from "./generated.ts";

export const SPECS: FunnelSpec[] = [agenticEn, ...GENERATED];
