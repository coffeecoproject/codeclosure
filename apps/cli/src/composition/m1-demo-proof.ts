import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CliDemoProofCode,
  type CliDemoProofResult,
  type CliDemoScenario,
} from '../cli/contracts.js';
import { runM1DirectProfileProof } from './m1-profile-demo-proof.js';
import { runM1RestartResumeProof } from './m1-restart-resume-proof.js';
import { runM1StaleCloseoutProof } from './m1-stale-closeout-proof.js';

export async function runM1DemoProof(scenario: CliDemoScenario): Promise<CliDemoProofResult> {
  switch (scenario) {
    case 'stale-closeout': {
      const projectRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m1-stale-project-'));
      const projectPath = join(projectRoot, 'project');
      mkdirSync(projectPath, { mode: 0o700 });
      try {
        const proof = await runM1StaleCloseoutProof({ projectPath });
        return Object.freeze({
          schemaVersion: 1,
          scenario,
          passed: true,
          proofCode: CliDemoProofCode.STALE_CLOSEOUT_INVALIDATED,
          goalId: proof.goalId,
          intermediateStatus: proof.beforeDrift,
          finalStatus: proof.finalStatus,
          reopenedStatus: proof.reopenedStatus,
          audit: proof.audit,
          finalDrive: proof.finalDrive,
        });
      } finally {
        rmSync(projectRoot, { force: true, recursive: true });
      }
    }
    case 'restart-resume':
      return runM1RestartResumeProof();
    case 'happy-path':
    case 'lying-worker':
    case 'missing-evidence':
    case 'failing-evidence':
    case 'duplicate-result':
    case 'candidate-drift':
      return runM1DirectProfileProof(scenario);
  }
}
