import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export function LogoutButton() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/login");
      toast.success("Logged out successfully");
    } catch (error) {
      toast.error("Error signing out");
    }
  };

  return (
    <Button 
      variant="ghost" 
      size="sm" 
      onClick={handleLogout}
      className="text-muted-foreground hover:text-destructive gap-2 bg-white/50 backdrop-blur-sm border border-gray-200/50 shadow-sm"
    >
      <LogOut className="w-4 h-4" />
      Logout
    </Button>
  );
}
