// Global cancellation also invalidates work awaiting input or metadata, before
// it has a scheduler. New operations capture the current generation normally.
let generation = 0;
export function cancelPendingOperations() { generation++; }
export function pendingOperationCheck() {
  const captured = generation;
  return () => { if (captured !== generation) throw new Error('Transfer cancelled'); };
}
