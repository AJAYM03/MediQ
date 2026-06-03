import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

export default function ProtectedRoute({ children, allowedRoles }) {
  const [isAuthorized, setIsAuthorized] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          // Wrap the database call in a try/catch
          const userDoc = await getDoc(doc(db, "users", user.uid));
          
          if (userDoc.exists() && allowedRoles.includes(userDoc.data().role)) {
            setIsAuthorized(true); 
          } else {
            console.warn("User does not have required role.");
            setIsAuthorized(false); 
          }
        } catch (error) {
          console.error("Failed to verify role:", error);
          setIsAuthorized(false); // If the database denies access, kick them out safely
        }
      } else {
        setIsAuthorized(false);
      }
    });

    return () => unsubscribe();
  }, [allowedRoles]);

  // Show a loading screen while checking the database
  if (isAuthorized === null) return <div className="p-10 text-center font-bold">Verifying Credentials...</div>;
  
  // If they fail the check, kick them back to the login screen
  if (isAuthorized === false) return <Navigate to="/" />;
  
  // If they pass, render the protected page (like the Admin Dashboard)
  return children;
}