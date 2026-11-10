import { Link, Navigate } from 'react-router-dom';
import { useSession } from '../lib/session.jsx';
import { dashPath } from '../lib/format.js';
import { useTitle } from '../lib/hooks.js';

// The landing page is for visitors. A signed-in user goes straight to their dashboard.
export default function Landing() {
  const { user } = useSession();
  useTitle('Ask to be paid');
  if (user) return <Navigate to={dashPath(user.role)} replace />;
  return (
    <main id="main">
        <section className="land-hero" aria-labelledby="banner-title">
          <div className="land-hero-inner">
            <div>
              <p className="land-kicker">Escrow on PayPal</p>
              <h1 id="banner-title">Ask for the money. It waits.</h1>
              <p className="lede">Write the item and the price. Send one link on WhatsApp or email. The buyer pays into a PayPal hold, and you are paid when they confirm the item. If something is wrong, an AI agent weighs the evidence and settles it in about a minute.</p>
              <div className="land-actions">
                <Link className="btn btn-gold" to="/signup?role=seller">Request a payment</Link>
                <Link className="btn btn-ghost" to="/market">Try the demo market</Link>
              </div>
            </div>
            <article className="card land-card">
              <p className="eyebrow">Payment request</p>
              <h2>Blue kitenge dress</h2>
              <p className="land-price">$45.00</p>
              <p>Size M, cotton. Ships from Nairobi to a buyer in London. This amount waits in PayPal until the buyer says the item is right.</p>
              <div className="land-card-foot">
                <span className="badge b-amber">Held</span>
                <Link className="btn btn-navy" to="/signup?role=seller">Send one like this</Link>
              </div>
            </article>
          </div>
        </section>

        <section className="land-steps" aria-labelledby="steps-title">
          <div>
            <p className="eyebrow">The path</p>
            <h2 id="steps-title">From a shop message to a hold</h2>
            <ol className="land-ol">
              <li><em>01</em><div><strong>Describe the sale</strong><span>Item, condition, and price. That is the whole request.</span></div></li>
              <li><em>02</em><div><strong>Send it yourself</strong><span>WhatsApp or email opens on your phone. You tap send.</span></div></li>
              <li><em>03</em><div><strong>The buyer joins</strong><span>The link creates their account, then the PayPal hold.</span></div></li>
              <li><em>04</em><div><strong>Then it moves</strong><span>They confirm, or a dispute decides capture, a partial, or a void.</span></div></li>
            </ol>
          </div>
          <div className="land-stack">
            <article className="card land-slip">
              <header>
                <h3>The message</h3>
                <span className="meta">WhatsApp or email</span>
              </header>
              <p className="msg">Blue kitenge dress is $45. The money stays on hold until you confirm you have it.</p>
              <Link to="/signup?role=buyer">Open the payment link</Link>
            </article>
            <article className="card land-slip">
              <header>
                <h3>On the buyer’s account</h3>
                <span className="badge b-amber">Held</span>
              </header>
              <p className="land-hold">$45.00<span>PayPal authorization. Captured only after they confirm.</span></p>
            </article>
          </div>
        </section>

        <section className="land-steps land-ai" aria-labelledby="ai-title">
          <div>
            <p className="eyebrow">When something is wrong</p>
            <h2 id="ai-title">An AI agent settles it in a minute, not a month</h2>
            <ol className="land-ol">
              <li><em>01</em><div><strong>The buyer shows what arrived</strong><span>A photo and a few words. The money stays on hold.</span></div></li>
              <li><em>02</em><div><strong>Claude weighs the evidence</strong><span>It compares the photo with the listing, checks tracking, the seller's record, market prices and known scams.</span></div></li>
              <li><em>03</em><div><strong>It moves the money itself</strong><span>Pay the seller, refund part, or void the hold so the buyer is never charged.</span></div></li>
              <li><em>04</em><div><strong>Unsure means a person decides</strong><span>Low confidence or conflicting evidence stops it in code. Every ruling is written down for both sides.</span></div></li>
            </ol>
          </div>
          <div className="land-stack">
            <article className="card land-slip">
              <header>
                <h3>Ruling · Sony WH-1000XM5</h3>
                <span className="badge b-violet">Hold voided</span>
              </header>
              <p className="msg">The photo shows in-ear earbuds branded "SONNY", not the over-ear Sony headphones listed. This matches a known lookalike-brand scam. The authorization is voided, so the buyer is not charged.</p>
              <div className="meter land-meter"><span className="meter-label">Confidence</span><div className="meter-track"><span style={{ width: '94%' }}></span></div><b>94%</b></div>
              <p className="land-trace">Looked at photo → Channel3 price check → Elastic scam search → PayPal void</p>
            </article>
            <article className="card land-slip">
              <header>
                <h3>Built for AI shoppers too</h3>
                <span className="badge b-indigo">MCP</span>
              </header>
              <p className="msg">An AI agent buying for you can check a seller's risk, pay into the hold, inspect the delivery photo and dispute on its own. Funguo works over a plain API or as an MCP server.</p>
              <Link to="/developer">For developers and agents</Link>
            </article>
          </div>
        </section>

        <section className="land-band" aria-labelledby="band-title">
          <div className="land-band-inner">
            <p className="land-kicker">Until they confirm</p>
            <h2 className="land-ghost" id="band-title">The money stays put.</h2>
            <p>Buyers who would never send money to a stranger abroad will pay into a hold, so more of your sales close. Nothing is captured on the way in. You ship, they accept, and the hold becomes your payment. Slow shipping is fine: Funguo reauthorizes the hold when PayPal's guarantee period ends.</p>
            <div className="land-actions">
              <Link className="btn btn-gold" to="/signup?role=seller">Start as a seller</Link>
              <Link className="btn btn-ghost" to="/login">Sign in</Link>
            </div>
          </div>
        </section>

        <section className="land-close">
          <div className="doors">
            <Link className="card door" to="/signup?role=seller">
              <p className="eyebrow">Selling</p>
              <strong>Your shop holds the request</strong>
              <span>Describe it, send the invite, and watch the order from the seller dashboard.</span>
            </Link>
            <Link className="card door" to="/signup?role=buyer">
              <p className="eyebrow">Paying</p>
              <strong>The link is the account</strong>
              <span>Open what you were sent, create a buyer account, and approve the hold.</span>
            </Link>
          </div>
          <p className="note">Selling from your own app or website? Add Pal-Lock beside PayPal Checkout. <Link to="/shop">See it in a cart</Link>, or <Link to="/developer">add it to your app</Link>. The link above stays for shops on TikTok, Instagram, and WhatsApp.</p>
          <p className="note">Before you pay a shop from TikTok, Instagram, or anywhere else, <Link to="/community">check the community list</Link> and report an account that took someone’s money.</p>
          <p className="note">Just looking? <Link to="/market">Open the demo market</Link> and buy with a sandbox card. Already registered? <Link to="/login">Sign in</Link> and you land on your own dashboard. Operator audit uses <code>admin@funguo.test</code> / <code>funguo-demo</code>.</p>
        </section>
      </main>
  );
}
