import { expect, mock, test } from 'claude-code/testing'

const cases = [
  { env: { LANG: 'ru_RU.UTF-8' }, words: [/5ч/, /нед/, /токенов/] },
  { env: { LANG: 'en_US.UTF-8' }, words: [/5h/, /wk/, /tokens/] },
]

for (const { env, words } of cases) {
  test(`band speaks the language of ${env.LANG}`, async ($, on) => {
    mock.clock(on, { now: 0 })
    mock.env(on, env)

    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
      const ui = await $.ui.mount({
        plugin: 'usage-monitor',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false },
      })
      for (const w of words) expect(await ui.find({ type: 'Text', text: w })).toBeDefined()
      await ui.unmount()
    }
  })
}
