/* Project Context — /repos/:repoId/context. The page file stays thin: one
   import of the view, because a Next.js special file is a routing declaration
   and not a place for feature logic. */
import { ContextView } from "./_components/ContextView/ContextView";

export default function ContextPage() {
  return <ContextView />;
}
