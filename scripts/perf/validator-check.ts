// TASK-200.1 — run the harness command bodies through the real shared
// validator. `perf:test` spawns this with tsx; it is not a runtime dependency
// of the harness.

import { validateBoardAction } from "../../shared/src/store/validate.ts";

const input = JSON.parse(process.argv[2] ?? "null");
const result = validateBoardAction(input);
process.stdout.write(JSON.stringify(result));
