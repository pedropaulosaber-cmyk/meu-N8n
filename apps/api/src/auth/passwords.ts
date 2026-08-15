import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com argon2id.
 *
 * argon2id combina resistência a ataque por GPU (memory-hard) com
 * resistência a ataque por canal lateral, e é a recomendação atual da
 * OWASP — melhor escolha que bcrypt para um projeto novo.
 *
 * Parâmetros seguindo o perfil "moderado" da OWASP: 19 MiB de memória,
 * 2 iterações, paralelismo 1. Custa ~50ms por verificação, o que é
 * irrelevante para um login e caro o bastante para quem tenta força bruta.
 */
const OPTIONS = {
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Verifica a senha. Retorna false em vez de lançar quando o hash está
 * corrompido — para quem chama, "não confere" e "hash inválido" levam
 * à mesma resposta, e não queremos diferenciar os dois para o cliente.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * Gasta o mesmo tempo de uma verificação real, sem ter um hash.
 *
 * Usado quando o e-mail não existe: sem isso, o login responderia bem
 * mais rápido para e-mail inexistente do que para senha errada, e essa
 * diferença de tempo permite enumerar quais contas existem.
 */
export async function fakeVerify(): Promise<void> {
  await hash('senha-descartavel-para-igualar-o-tempo', OPTIONS);
}
