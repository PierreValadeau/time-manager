import bcrypt from 'bcryptjs'

const BCRYPT_ROUNDS = 12; 

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);