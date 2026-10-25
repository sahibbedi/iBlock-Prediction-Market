import React, { createContext, useContext, useEffect, useState } from "react";
import { User, useGetMe, setAuthTokenGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

setAuthTokenGetter(() => localStorage.getItem("ibpm_token"));

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("ibpm_token"));
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: user, isLoading, isError } = useGetMe({
    query: {
      enabled: !!token,
      queryKey: ["/api/auth/me", token],
      retry: false,
    },
  });

  const login = (newToken: string) => {
    queryClient.clear();
    localStorage.setItem("ibpm_token", newToken);
    setToken(newToken);
  };

  const logout = () => {
    queryClient.clear();
    localStorage.removeItem("ibpm_token");
    setToken(null);
    setLocation("/");
  };

  useEffect(() => {
    if (isError) {
      logout();
    }
  }, [isError]);

  return (
    <AuthContext.Provider value={{ user: token ? user || null : null, isLoading: isLoading && !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function withAuthHeaders(options?: any) {
  const token = localStorage.getItem("ibpm_token");
  return {
    ...options,
    request: {
      ...options?.request,
      headers: {
        ...options?.request?.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  };
}
