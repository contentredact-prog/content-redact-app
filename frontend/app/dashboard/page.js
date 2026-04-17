'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // Check if the user is actually logged in
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        // If no active session, kick them back to the login screen
        router.push('/login')
      } else {
        // If logged in, grab their info
        setUser(session.user)
      }
      setLoading(false)
    }

    checkUser()
  }, [router])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Show a blank or loading screen while checking auth status
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-6 border border-gray-100">
        
        {/* Header Section */}
        <div className="flex justify-between items-center mb-8 border-b pb-4">
          <h1 className="text-2xl font-bold text-gray-900">Creator Dashboard</h1>
          <button 
            onClick={handleSignOut}
            className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
          >
            Sign Out
          </button>
        </div>
        
        {/* User Info Section */}
        <div className="bg-gray-50 p-4 rounded-md border border-gray-100 mb-8">
          <p className="text-gray-700"><strong>Securely logged in as:</strong> {user?.email}</p>
          <p className="text-gray-500 text-sm mt-1">
            Authentication Provider: <span className="capitalize">{user?.app_metadata?.provider}</span>
          </p>
        </div>

        {/* DMCA Placeholder Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Discovered Matches</h2>
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-lg p-12 text-center">
            <p className="text-gray-500">
              Your stolen content matches and recovery metrics will populate here once the Python engine begins its sweep.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}