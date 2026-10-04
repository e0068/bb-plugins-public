/**
 * bb's DOM guard, as the app installs it: while any plugin's async work is in
 * flight, a node React made is not put into a parent React does not own — the
 * call is dropped without a word. <body> is such a parent, so an overlay
 * portaled there never shows. Removing a node that is not there — one the
 * guard dropped — is passed over the same way. Returns the way to take the
 * guard off.
 */
export function installBbDomGuard(): () => void {
  const ownedByReact = (node: Node) => Object.getOwnPropertyNames(node).some((key) => key.startsWith("__reactFiber$"));
  const dropped = (node: Node, parent: Node) =>
    node.parentNode !== parent && ownedByReact(node) && !(node.parentNode === null && ownedByReact(parent));
  const append = Node.prototype.appendChild;
  const insert = Node.prototype.insertBefore;
  const remove = Node.prototype.removeChild;
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    return dropped(node, this) ? node : (append.call(this, node) as T);
  };
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
    return dropped(node, this) ? node : (insert.call(this, node, child) as T);
  };
  Node.prototype.removeChild = function <T extends Node>(this: Node, node: T): T {
    return node.parentNode === this ? (remove.call(this, node) as T) : node;
  };
  return () => {
    Node.prototype.appendChild = append;
    Node.prototype.insertBefore = insert;
    Node.prototype.removeChild = remove;
  };
}
