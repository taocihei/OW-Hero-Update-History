import { openUrl } from "@tauri-apps/plugin-opener";

const WEB_URL = /^https?:\/\//i;

export async function openExternalUrl(url: string): Promise<void> {
  if (!WEB_URL.test(url)) return;

  if ("__TAURI_INTERNALS__" in window) {
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function installExternalLinkHandler(): () => void {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !WEB_URL.test(anchor.href)) return;

    event.preventDefault();
    void openExternalUrl(anchor.href);
  };

  document.addEventListener("click", handleClick, true);
  return () => document.removeEventListener("click", handleClick, true);
}
