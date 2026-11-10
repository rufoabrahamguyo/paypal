import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Layout, { RequireUser } from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import { Login, Signup } from './pages/Auth.jsx';
import Market from './pages/Market.jsx';
import Listing from './pages/Listing.jsx';
import Checkout from './pages/Checkout.jsx';
import Invite from './pages/Invite.jsx';
import Sellers from './pages/Sellers.jsx';
import SellerProfile from './pages/SellerProfile.jsx';
import Community from './pages/Community.jsx';
import Order from './pages/Order.jsx';
import Receipt from './pages/Receipt.jsx';
import Support from './pages/Support.jsx';
import Buyer from './pages/Buyer.jsx';
import Seller from './pages/Seller.jsx';
import Onboarding from './pages/Onboarding.jsx';
import DeveloperHome from './pages/developer/DeveloperHome.jsx';
import DeveloperDocs from './pages/developer/DeveloperDocs.jsx';
import DeveloperDashboard from './pages/developer/DeveloperDashboard.jsx';
import Shop from './pages/Shop.jsx';
import NotFound from './pages/NotFound.jsx';

// The audit desk pulls in AG Grid, so it loads only when someone opens it.
const Admin = lazy(() => import('./pages/Admin.jsx'));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* The sample merchant has its own branding, outside Funguo's chrome. */}
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop/done" element={<Shop />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/market" element={<Market />} />
          <Route path="/l/:id" element={<Listing />} />
          <Route path="/checkout/:id" element={<Checkout />} />
          <Route path="/i/:id" element={<Invite />} />
          <Route path="/sellers" element={<Sellers />} />
          <Route path="/s/:id" element={<SellerProfile />} />
          <Route path="/community" element={<Community />} />
          <Route path="/o/:id" element={<Order />} />
          <Route path="/o/:id/receipt" element={<Receipt />} />
          <Route path="/support" element={<RequireUser><Support /></RequireUser>} />
          <Route path="/support/:id" element={<RequireUser><Support /></RequireUser>} />
          <Route path="/buyer" element={<RequireUser role="buyer"><Buyer view="overview" /></RequireUser>} />
          <Route path="/buyer/orders" element={<RequireUser role="buyer"><Buyer view="orders" /></RequireUser>} />
          <Route path="/seller" element={<RequireUser role="seller"><Seller view="overview" /></RequireUser>} />
          <Route path="/seller/orders" element={<RequireUser role="seller"><Seller view="orders" /></RequireUser>} />
          <Route path="/seller/listings" element={<RequireUser role="seller"><Seller view="listings" /></RequireUser>} />
          <Route path="/seller/verification" element={<RequireUser role="seller"><Seller view="verification" /></RequireUser>} />
          <Route path="/seller/onboarding" element={<RequireUser role="seller"><Onboarding /></RequireUser>} />
          <Route path="/admin" element={<RequireUser role="admin"><Suspense fallback={null}><Admin /></Suspense></RequireUser>} />
          <Route path="/developer" element={<DeveloperHome />} />
          <Route path="/developer/docs" element={<DeveloperDocs />} />
          <Route path="/developer/dashboard" element={<RequireUser><DeveloperDashboard /></RequireUser>} />
          <Route path="/developer/apps/:id" element={<RequireUser><DeveloperDashboard /></RequireUser>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
