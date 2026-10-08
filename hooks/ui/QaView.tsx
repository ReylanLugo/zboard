import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { isDone } from '../plan/lifecycle.ts'
import type { ChangeRecord } from '../plan/types.ts'
import { BRAINSTORM_ARTIFACT, QA_CAP } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { answerQuestion, draftFromTurns, finishBrainstorm } from '../runtime/plan-brainstorm.ts'
import { act } from './changes-actions.ts'
import type { Els } from './els.ts'
import { keyed } from './format.ts'

export const showsQa = (rec: ChangeRecord): boolean =>
  rec.qa !== undefined && (!rec.qa.done || (rec.qa.capped && !isDone(rec, BRAINSTORM_ARTIFACT)))

export function QaView(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord): RenderElement {
  const { Box, Button, Input, Text } = els
  const qa = rec.qa ?? { turns: [], done: false, capped: false }
  const last = qa.turns.at(-1)
  const open = !qa.done && last !== undefined && last.answer === undefined ? last : undefined
  const answered = qa.turns.filter(turn => turn.answer !== undefined)
  const answer = (value: string): void => act(io, rec, 'qa.answer', () => answerQuestion(io, ctx, rec.id, value))()
  return (
    <Box key="qa" flexDirection="column">
      <Box key="qa-title"><Text bold>{`Brainstorm Q&A · ${answered.length}/${QA_CAP} answered`}</Text></Box>
      {answered.map((turn, index) => <Box key={`qa-turn:${index}`}><Text dimColor>{`Q${index + 1} ${turn.question} → ${turn.answer ?? ''}`}</Text></Box>)}
      {open === undefined
        ? <Box key="qa-wait"><Text dimColor>{qa.done ? `The Q&A ended at ${QA_CAP} answers; draft brainstorm.md from the turns.` : 'Waiting for the next question…'}</Text></Box>
        : [
          <Box key="qa-question"><Text bold>{open.question}</Text></Box>,
          <Box key="qa-why"><Text dimColor>{open.why}</Text></Box>,
          <Box key="qa-options" flexDirection="column">
            {open.options.map((option, index) => <Button key={`qa-option:${index}`} {...keyed(String(index + 1), option)} onPress={() => answer(option)} />)}
          </Box>,
          <Input key="qa-answer" label="or answer in your own words" placeholder="type, then Enter" onSubmit={value => answer(value)} />,
        ]}
      {qa.done
        ? <Button key="qa-draft" label="draft brainstorm.md from the turns" onPress={act(io, rec, 'qa.draft', () => draftFromTurns(io, ctx, rec.id))} />
        : <Button key="qa-finish" {...keyed('f', 'finish')} onPress={act(io, rec, 'qa.finish', () => finishBrainstorm(io, ctx, rec.id))} />}
    </Box>
  )
}
