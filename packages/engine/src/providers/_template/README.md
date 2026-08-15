# Esqueleto de provedor de IA

Copie `provider.example.ts` para `../<seu-provedor>/index.ts`, preencha e
registre em `../../registry/index.ts`.

Depois disso o provedor aparece sozinho no dropdown "Provedor" da ação
`ai-generate`, com seus modelos no dropdown "Modelo", e ganha card na aba
Integrações. **Nenhuma automação existente precisa ser alterada** — trocar
de provedor vira uma mudança de dropdown.

## Checklist

- [ ] `id` único e estável (vai para o banco; renomear depois quebra automações)
- [ ] `models` com os modelos que você realmente quer expor
- [ ] `credentialFields` com `type: 'secret'` nos campos sensíveis
- [ ] `generate()` repassa `ctx.signal` para o `fetch`
- [ ] Erros mapeados com `retryable` correto (401 não, 429/5xx sim)
- [ ] Registrado em `registry/index.ts`
- [ ] `pnpm typecheck && pnpm test`

## Custo

Se o provedor for pago sem camada gratuita, diga isso no `description` —
o texto aparece no card da aba Integrações, antes de alguém conectar.
