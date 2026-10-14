/**
 * A copied reference names the file, then the place in it, then what the inspector says about
 * it, so that it reads well when pasted into a chat with an AI assistant or into a note:
 *
 *     models/robot.glb, node "Arm" (nodes[12]), under Root › Body:
 *     Node
 *     - mesh: Arm
 */
export function composeReference(file: string, location?: string, details?: string): string {
  const head = location ? `${file}, ${location}` : file;
  return details ? `${head}:\n${details}` : head;
}
