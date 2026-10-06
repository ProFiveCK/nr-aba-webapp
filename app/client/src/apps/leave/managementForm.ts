export const value = (data: FormData, key: string) => String(data.get(key) || '').trim();
