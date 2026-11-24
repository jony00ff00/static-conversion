import type { SetupStep } from '../model/types.js';

/** How a recorded step reads in a warning. */
export function describeStep(step: SetupStep): string {
  if (step.action === 'scroll') return `scroll ${step.selector ?? 'page'} to ${Math.round(step.x)}, ${Math.round(step.y)}`;
  if (step.action === 'check') return `${step.checked ? 'tick' : 'untick'} ${step.selector}`;
  if (step.action === 'select') return `choose "${step.value}" in ${step.selector}`;
  return `click ${step.selector}`;
}
