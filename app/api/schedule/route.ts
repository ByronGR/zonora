import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { candidate_name, candidate_email, meeting_link, scheduled_at } = body

  const supabase = createServerClient()

  // Save to Supabase
  const { data: interview, error } = await supabase
    .from('interviews')
    .insert([{ candidate_name, candidate_email, meeting_link, scheduled_at }])
    .select()
    .single()

  if (error) {
    console.error('Supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Send bot to meeting via Recall.ai
  const recallRes = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: meeting_link,
      bot_name: 'Zonora',
      join_at: new Date(scheduled_at).toISOString(),
    }),
  })

  const recallData = await recallRes.json()

  if (!recallRes.ok) {
    console.error('Recall.ai error:', recallData)
    return NextResponse.json({ error: 'Recall.ai error', details: recallData }, { status: 500 })
  }

  // Save the Recall bot ID to the interview record
  await supabase
    .from('interviews')
    .update({ recall_bot_id: recallData.id })
    .eq('id', interview.id)

  return NextResponse.json({ success: true, interview, bot: recallData })
}
