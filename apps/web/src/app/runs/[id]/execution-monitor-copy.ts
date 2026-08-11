export function stageFailureDetail(reason: string): string {
  if (/stdout maxBuffer length exceeded/i.test(reason)) {
    return 'Git output exceeded the worker buffer';
  }
  return reason;
}
