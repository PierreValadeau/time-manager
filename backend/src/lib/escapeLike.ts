// LIKE treats %, _ and \ as syntax: escape them so the user's text is matched literally
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');
