export function canonicalTaskSignal(
  openTasks: number,
  tasks: ReadonlyArray<{ id: string; kind: string; status: string }>,
) {
  return `${openTasks}:${tasks
    .map(({ id, kind, status }) => `${id}:${kind}:${status}`)
    .sort()
    .join("|")}`;
}
