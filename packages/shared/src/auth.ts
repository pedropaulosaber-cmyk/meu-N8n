import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/**
 * Política de senha do owner. Aplicada na troca de senha e no seed inicial.
 * Comprimento é o fator que mais importa; exigimos variedade só o suficiente
 * para barrar senhas triviais, sem empurrar o usuário para padrões previsíveis.
 */
export const passwordSchema = z
  .string()
  .min(12, 'A senha precisa ter ao menos 12 caracteres')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), 'Use letras maiúsculas e minúsculas')
  .refine((v) => /[0-9]/.test(v), 'Use ao menos um número');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  user: sessionUserSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;
