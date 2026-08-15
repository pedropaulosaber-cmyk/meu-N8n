import { useState } from 'react';
import { auth, ApiError } from '../lib/api';
import { PrimaryButton, TextInput, Field } from '../components/ui';

/**
 * Traduz a falha de login.
 *
 * Só um 401 significa credencial errada. Tratar toda falha como senha
 * incorreta — como esta tela fazia antes — manda o usuário depurar a
 * senha quando o problema real é o banco fora do ar ou a API parada.
 * A mensagem genérica para o 401 continua proposital: é o backend não
 * revelando se o e-mail existe.
 */
function describeLoginError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Não foi possível falar com o servidor. Verifique se a API está no ar.';
  }
  if (err.status === 401) return 'E-mail ou senha incorretos.';
  if (err.status === 429) {
    return 'Muitas tentativas. Aguarde um minuto antes de tentar de novo.';
  }
  if (err.status >= 500) {
    return 'O servidor falhou ao processar o login. Verifique se o banco de dados está acessível.';
  }
  return err.message;
}

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
      onSuccess();
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex w-full max-w-[380px] flex-col gap-6 rounded-[20px] border border-line-strong bg-raised p-8 shadow-[0_40px_90px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-linear-140 from-accent to-accent-alt">
            <span className="h-[11px] w-[11px] rotate-45 rounded-[3px] border-2 border-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-display text-[15.5px] font-semibold tracking-[-0.02em]">
              Órbita
            </span>
            <span className="text-[10.5px] tracking-[0.04em] text-ink-dim">
              Método CRM · Automações
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="E-mail">
            <TextInput value={email} onChange={setEmail} type="email" autoFocus />
          </Field>
          <Field label="Senha">
            <TextInput value={password} onChange={setPassword} type="password" />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-[12.5px] text-[#FF9AA3]">
            {error}
          </p>
        )}

        <PrimaryButton type="submit" disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </PrimaryButton>
      </form>
    </div>
  );
}
