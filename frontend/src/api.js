import axios from "axios";

function resolveBaseURL() {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return `${window.location.origin}/api`;
  }
  return "http://localhost:4000/api";
}

const api = axios.create({
  baseURL: resolveBaseURL(),
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export default api;
