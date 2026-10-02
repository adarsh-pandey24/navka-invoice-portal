import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiClient from '../services/api';
import { User, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('navka_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize and verify existing token on app start
  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('navka_token');
      const storedUser = localStorage.getItem('navka_user');

      if (storedToken && storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          setToken(storedToken);

          // Verify token validity with backend
          const res = await apiClient.get('/auth/me');
          if (res.data?.success && res.data.user) {
            setUser(res.data.user);
            localStorage.setItem('navka_user', JSON.stringify(res.data.user));
          }
        } catch (error) {
          console.warn('[Auth] Session validation failed. Clearing credentials.');
          localStorage.removeItem('navka_token');
          localStorage.removeItem('navka_user');
          setUser(null);
          setToken(null);
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      if (response.data?.success && response.data.token) {
        const receivedToken = response.data.token;
        const loggedUser: User = response.data.user;

        localStorage.setItem('navka_token', receivedToken);
        localStorage.setItem('navka_user', JSON.stringify(loggedUser));

        setToken(receivedToken);
        setUser(loggedUser);

        return { success: true };
      }
      return { success: false, message: response.data?.message || 'Login failed.' };
    } catch (error: any) {
      const errMsg = error.response?.data?.message || 'Invalid email or password.';
      return { success: false, message: errMsg };
    }
  };

  const logout = () => {
    localStorage.removeItem('navka_token');
    localStorage.removeItem('navka_user');
    setUser(null);
    setToken(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
