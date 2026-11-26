const SPOTLIGHT_FILE = 'spotlight-'
/** No file holds a spotlight's picture: a board draws it (spotlight-pictures.tsx) for an image with this file id. */
export const spotlightOfFile = (fileId: string): string | undefined => (fileId.startsWith(SPOTLIGHT_FILE) ? fileId.slice(SPOTLIGHT_FILE.length) : undefined)
