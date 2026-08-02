import {
  CliOperation,
  type CliDemoResult,
  type CliDemoResultEnvelope,
  type CliDemoScenario,
} from '../cli/contracts.js';

export interface DemoProofCapability {
  run(scenario: CliDemoScenario): Promise<CliDemoResult>;
}

export async function executeDemoRun(
  capability: DemoProofCapability,
  scenario: CliDemoScenario,
): Promise<CliDemoResultEnvelope> {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'DEMO_RESULT',
    operation: CliOperation.DEMO_RUN,
    result: await capability.run(scenario),
  });
}
