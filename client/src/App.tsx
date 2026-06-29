import { Switch, Route, Router } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Layout from "@/components/Layout";
import Browse from "@/pages/Browse";
import Species from "@/pages/Species";
import MapSearch from "@/pages/MapSearch";
import About from "@/pages/About";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Profile from "@/pages/Profile";
import EditProfile from "@/pages/EditProfile";
import NewRecord from "@/pages/NewRecord";
import RecordDetail from "@/pages/Record";
import NewNote from "@/pages/NewNote";
import Note from "@/pages/Note";
import Feed from "@/pages/Feed";
import Users from "@/pages/Users";
import Leaderboard from "@/pages/Leaderboard";
import Notifications from "@/pages/Notifications";
import Admin from "@/pages/Admin";
import { Followers, Following } from "@/pages/FollowList";

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Feed} />
        <Route path="/browse" component={Browse} />
        <Route path="/species/:id" component={Species} />
        <Route path="/map" component={MapSearch} />
        <Route path="/about" component={About} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/feed" component={Feed} />
        <Route path="/new" component={NewRecord} />
        <Route path="/notes/new" component={NewNote} />
        <Route path="/n/:id" component={Note} />
        <Route path="/users" component={Users} />
        <Route path="/leaderboard" component={Leaderboard} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/me/edit" component={EditProfile} />
        <Route path="/u/:username/followers" component={Followers} />
        <Route path="/u/:username/following" component={Following} />
        <Route path="/u/:username" component={Profile} />
        <Route path="/r/:id" component={RecordDetail} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router>
            <AppRouter />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
