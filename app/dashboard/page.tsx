'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

type Interview = {
  id: string
  candidate_name: string
  candidate_email: string
  meeting_link: string
  scheduled_at: string
  status: string
  recall_bot_id: string | null
  report: Record<string, unknown> | null
}

export default function Dashboard() {
  const supabase = createClient()
  const router = useRouter()
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [form, setForm] = useState({
    candidate_name: '',
    candidate_email: '',
    meeting_link: '',
    scheduled_at: '',
  })

  useEffect(() => {
    fetchInterviews()
  }, [])

  async function fetchInterviews() {
    const { data } = await supabase
      .from('interviews')
      .select('*')
      .order('scheduled_at', { ascending: true })
    if (data) setInterviews(data)
  }

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
      }),
    })

    if (!res.ok) {
      const errData = await res.json()
      alert('Error: ' + JSON.stringify(errData))
      setLoading(false)
      return
    }

    await fetchInterviews()
    setForm({ candidate_name: '', candidate_email: '', meeting_link: '', scheduled_at: '' })
    setShowForm(false)
    setLoading(false)
  }

  const now = new Date()
  const upcoming = interviews.filter(i => new Date(i.scheduled_at) >= now)
  const past = interviews.filter(i => new Date(i.scheduled_at) < now)
  const todayCount = interviews.filter(i => {
    const d = new Date(i.scheduled_at)
    return d.toDateString() === now.toDateString()
  }).length

  function formatDate(str: string) {
    return new Date(str).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  function InterviewRow({ interview }: { interview: Interview }) {
    const isPast = new Date(interview.scheduled_at) < now
    const hasReport = !!interview.report

    return (
      <div
        onClick={() => router.push(`/dashboard/interviews/${interview.id}`)}
        className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition cursor-pointer"
      >
        <div>
          <p className="font-medium text-gray-900">{interview.candidate_name}</p>
          <p className="text-sm text-gray-500">{interview.candidate_email}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm text-gray-700">{formatDate(interview.scheduled_at)}</p>
            <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
              hasReport ? 'bg-green-100 text-green-700' :
              isPast ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
            }`}>
              {hasReport ? 'report ready' : isPast ? 'completed' : 'upcoming'}
            </span>
          </div>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    )
  }

  const displayed = tab === 'upcoming' ? upcoming : past

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <span className="font-bold text-gray-900">Zonora</span>
        </div>
        <span className="text-sm text-gray-500">Recruiter Dashboard</span>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
            <p className="text-gray-500">Manage your Zonora interviews.</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition"
          >
            + Schedule Interview
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Interviews Today</p>
            <p className="text-3xl font-bold text-gray-900">{todayCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Upcoming</p>
            <p className="text-3xl font-bold text-gray-900">{upcoming.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-500 mb-1">Completed</p>
            <p className="text-3xl font-bold text-gray-900">{past.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 pt-4 border-b border-gray-100 flex items-center gap-6">
            <button
              onClick={() => setTab('upcoming')}
              className={`pb-3 text-sm font-semibold border-b-2 transition ${
                tab === 'upcoming' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Upcoming ({upcoming.length})
            </button>
            <button
              onClick={() => setTab('past')}
              className={`pb-3 text-sm font-semibold border-b-2 transition ${
                tab === 'past' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Past ({past.length})
            </button>
          </div>

          {displayed.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-400 text-sm">
                {tab === 'upcoming' ? 'No upcoming interviews. Click "Schedule Interview" to add one.' : 'No past interviews yet.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {displayed.map(i => <InterviewRow key={i.id} interview={i} />)}
            </div>
          )}
        </div>
      </div>

      {/* Schedule form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Schedule Interview</h2>
            <p className="text-gray-500 text-sm mb-6">Zonora will automatically join this meeting.</p>
            <form onSubmit={handleSchedule} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Candidate Name</label>
                <input type="text" placeholder="Maria Garcia" value={form.candidate_name}
                  onChange={e => setForm({ ...form, candidate_name: e.target.value })} required
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Candidate Email</label>
                <input type="email" placeholder="maria@email.com" value={form.candidate_email}
                  onChange={e => setForm({ ...form, candidate_email: e.target.value })} required
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Meeting Link</label>
                <input type="url" placeholder="https://meet.google.com/..." value={form.meeting_link}
                  onChange={e => setForm({ ...form, meeting_link: e.target.value })} required
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Date & Time</label>
                <input type="datetime-local" value={form.scheduled_at}
                  onChange={e => setForm({ ...form, scheduled_at: e.target.value })} required
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-60">
                  {loading ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  )
}
