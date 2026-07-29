import {
  CliOperation,
  type CliDemoProofResult,
  type CliDemoResultEnvelope,
  type CliDemoScenario,
} from '../cli/contracts.js';

export interface M1DemoProofCapability {
  run(scenario: CliDemoScenario): Promise<CliDemoProofResult>;
}

export async function executeDemoRun(
  capability: M1DemoProofCapability,
  scenario: CliDemoScenario,
): Promise<CliDemoResultEnvelope> {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'DEMO_RESULT',
    operation: CliOperation.DEMO_RUN,
    result: await capability.run(scenario),
  });
}
