# Como adicionar uma integração

Este é o documento mais importante do projeto. A arquitetura foi desenhada
para que adicionar uma integração nova seja **criar um arquivo e registrá-lo**
— sem tocar no motor de execução, na API ou no painel.

Existem três famílias de módulo. Escolha a que corresponde ao que você quer:

| Quero… | Família | Pasta |
|---|---|---|
| Iniciar uma automação a partir de um evento | **trigger** | `packages/engine/src/triggers/` |
| Executar algo quando a automação roda | **action** | `packages/engine/src/actions/` |
| Disponibilizar um novo modelo de IA | **ai_provider** | `packages/engine/src/providers/` |

Cada pasta tem um `_template/` comentado. Copie, renomeie, preencha.

---

## O contrato

Todo módulo exporta um objeto de definição. Os campos que importam:

```ts
{
  id: 'meu-modulo',            // único no sistema; vira o valor gravado no banco
  name: 'Meu Módulo',          // rótulo no painel
  description: '...',          // texto do card na aba Integrações
  icon: 'zap',                 // ícone resolvido pelo painel
  configFields: [...],         // campos por automação  → viram formulário + validação
  credentialFields: [...],     // campos de segredo     → viram a tela de credencial
  async run(ctx) { ... }       // o que o módulo faz (actions e providers)
}
```

### Por que declarar `configFields` em vez de um schema Zod

Porque um array de descritores serve a três consumidores de uma vez:

1. **Validação** — `fieldsToZod()` gera o schema Zod usado pela API.
2. **Formulário** — o painel renderiza os campos genericamente.
3. **Catálogo** — a aba Integrações lista os campos sem código específico.

Se você escrevesse o Zod à mão, teria que duplicar essa informação em três
lugares e mantê-los sincronizados. O descritor é a fonte única.

Quando precisar de validação que o descritor não expressa (ex: "se o campo A
for X, então B é obrigatório"), use o `refineConfig` opcional da definição.

---

## Receita: nova **ação**

1. `cp -r packages/engine/src/actions/_template packages/engine/src/actions/minha-acao`
2. Preencha `id`, `name`, `description`, `icon`.
3. Declare `configFields` — o que o usuário configura por automação.
4. Declare `credentialFields` se a ação falar com um serviço externo autenticado.
5. Implemente `run(ctx)`. O `ctx` te dá:
   - `ctx.config` — já validado e com os `{{ }}` resolvidos
   - `ctx.credentials` — segredos já descriptografados (só existem em memória)
   - `ctx.trigger` — payload que iniciou a automação
   - `ctx.steps` — resultados das ações anteriores
   - `ctx.logger` — log já mascarado
   - `ctx.signal` — `AbortSignal` do timeout; **respeite-o** em chamadas de rede
6. Registre em `packages/engine/src/registry/index.ts`.
7. `pnpm typecheck && pnpm test`

Pronto. A ação já aparece no dropdown do editor de automação e na aba
Integrações, com formulário e validação funcionando.

---

## Receita: novo **provedor de IA**

Igual à ação, mas implementando a interface `AIProvider`:

```ts
generate(input: AIInput, creds: Creds): Promise<AIResult>
```

O contrato é intencionalmente pequeno para caber em qualquer API — o
adaptador é quem traduz o formato do fornecedor para o nosso.

Depois de registrar, o provedor aparece automaticamente no dropdown
"Provedor" da ação `ai-generate`, com seus modelos no dropdown "Modelo".
**Nenhuma automação existente precisa ser alterada.**

Ver `packages/engine/src/providers/gemini/` para o exemplo real e
`packages/engine/src/providers/_template/` para o esqueleto comentado.

---

## Regras que valem para qualquer módulo

- **Nunca logue segredo.** Use `ctx.logger`; ele já passa pelo mascarador.
  Se precisar logar um objeto que veio de fora, ele também é mascarado.
- **Respeite `ctx.signal`.** Sem isso o timeout não funciona e um serviço
  externo lento trava um slot do worker.
- **Erros devem ser específicos.** Lance `ActionError` com um `code` estável
  (ex: `CREDENTIAL_EXPIRED`) para o histórico ficar diagnosticável.
- **Nada de `eval`.** Entrada de webhook é dado, nunca código.
- **Sem dependência paga** sem antes avisar o dono do projeto.
