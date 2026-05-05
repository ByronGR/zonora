import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = createServerClient()

  const botId = body.bot_id
  const words = body.words

  if (!botId || !words) {
    return NextResponse.json({ received: true })
  }

  // Find the interview with this bot ID
  const { data: interview } = await supabase
    .from('interviews')
    .select('id, transcript')
    .eq('recall_bot_id', botId)
    .single()

  if (!interview) {
    return NextResponse.json({ received: true })
  }

  // Append new words to existing transcript
  const newText = words.map((w: { text: string }) => w.text).join(' ')
  const existing = interview.transcript || ''
  const updated = existing ? existing + ' ' + newText : newText

  await supabase
    .from('interviews')
    .update({ transcript: updated })
    .eq('id', interview.id)

  return NextResponse.json({ received: true })
}
