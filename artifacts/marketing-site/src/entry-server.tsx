import { renderToString } from "react-dom/server";
import App from "./App";
import { routeMeta, renderHead, NOT_FOUND_META } from "./lib/seo";

/** Render a route's React tree to an HTML string for build-time prerendering. */
export function render(pathname: string): string {
  return renderToString(<App ssrPath={pathname} />);
}

export { routeMeta, renderHead, NOT_FOUND_META };
