/**
 * Clipboard hand-off for the growth read-out.
 *
 * Two paths, because the async clipboard API needs a secure context *and* a user
 * gesture, and a host page can be missing either: the modern call, and a hidden
 * textarea with `execCommand` for everything else. Copying silently nothing
 * would be worse than the deprecated fallback.
 * @module @deepseek-ai/dsh-client-ui-pet/client/clipboard
 */

/**
 * Put `text` on the clipboard.
 * @param text - the text to copy.
 * @returns whether the copy is believed to have reached the clipboard.
 */
export function copyToClipboard(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    // Rejections here are permission refusals the caller cannot act on, and the
    // promise is not worth surfacing as a caption over the pet.
    void navigator.clipboard.writeText(text).catch(() => undefined)
    return true
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
