// Capitalizes the first letter of each space-separated word.
export const titleCase = (str: string): string =>
    str
        .toLowerCase()
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
