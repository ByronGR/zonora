'use client'

import { useState } from 'react'

type Step = 'form' | 'submitted'

export default function BookPage() {
  const [step, setStep] = useState<Step>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    candidate_name: '',
    candidate_email: '',
    meeting_link: '',
    scheduled_at: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          scheduled_at: new Date(form.scheduled_at).toISOString(),
        }),
      })

      const text = await res.text()
      const data = text ? JSON.parse(text) : {}

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
      } else {
        setStep('submitted')
      }
    } catch {
      setError('Could not connect. Please check your internet and try again.')
    }

    setLoading(false)
  }

  // Get min datetime (now, rounded up to next 15 min)
  function getMinDatetime() {
    const now = new Date()
    now.setMinutes(now.getMinutes() + 15)
    now.setSeconds(0, 0)
    const offset = now.getTimezoneOffset()
    const local = new Date(now.getTime() - offset * 60000)
    return local.toISOString().slice(0, 16)
  }

  if (step === 'submitted') {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-md p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">You're all set!</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Your interview has been scheduled. An AI assistant will automatically join your meeting at the selected time to conduct a short English proficiency check.
          </p>
          <p className="text-gray-400 text-xs mt-6">Powered by Zonora · Nearwork</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <span className="font-bold text-gray-900 text-lg">Zonora</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Schedule your interview</h1>
          <p className="text-gray-500 text-sm mb-7">
            An AI assistant will join your video call to conduct a short English proficiency check. The whole process takes about 5–10 minutes.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
              <input
                type="text"
                placeholder="Maria Garcia"
                value={form.candidate_name}
                onChange={e => setForm({ ...form, candidate_name: e.target.value })}
                required
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
              <input
                type="email"
                placeholder="maria@email.com"
                value={form.candidate_email}
                onChange={e => setForm({ ...form, candidate_email: e.target.value })}
                required
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Meeting Link</label>
              <input
                type="url"
                placeholder="https://meet.google.com/..."
                value={form.meeting_link}
                onChange={e => setForm({ ...form, meeting_link: e.target.value })}
                required
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1.5">Google Meet, Zoom, or Microsoft Teams links are supported.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Date & Time</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                min={getMinDatetime()}
                onChange={e => setForm({ ...form, scheduled_at: e.target.value })}
                required
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-60 mt-2"
            >
              {loading ? 'Scheduling…' : 'Schedule Interview'}
            </button>
          </form>
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">Powered by Zonora · Nearwork</p>
      </div>
    </main>
  )
}
