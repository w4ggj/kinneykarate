import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  FlatList,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStripeTerminal, Reader } from '@stripe/stripe-terminal-react-native';
import { RootStackParamList } from '../../App';
import * as api from '../api';
import type { Product, ProductVariant } from '../api';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'POS'>;
};

type ReaderStatus = 'idle' | 'connecting' | 'ready' | 'error';

interface LastResult {
  success: boolean;
  message: string;
}

interface FixedItem {
  id: string;
  name: string;
  price_cents: number;
}

const FIXED_ITEMS: FixedItem[] = [
  { id: 'exam-standard', name: 'Exam — Standard', price_cents: 3500 },
  { id: 'exam-candidate', name: 'Exam — Candidate', price_cents: 5000 },
];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function POSScreen({ navigation }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>('idle');
  const [readerError, setReaderError] = useState<string | null>(null);
  const [charging, setCharging] = useState(false);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [variantModal, setVariantModal] = useState<{ product: Product } | null>(null);
  // "How to Tap" setup modal — shown before first discovery on iOS
  const [setupModal, setSetupModal] = useState(Platform.OS === 'ios');
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    initialize,
    discoverReaders,
    connectLocalMobileReader,
    collectPaymentMethod,
    processPayment,
    cancelCollectPaymentMethod,
    connectedReader,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: useCallback((readers: Reader.Type[]) => {
      if (readers.length > 0) {
        connectLocalMobileReader({ reader: readers[0] })
          .then(({ reader: connected, error }) => {
            if (error) {
              setReaderStatus('error');
              setReaderError(error.message ?? 'Connection failed.');
            } else if (connected) {
              setReaderStatus('ready');
              setReaderError(null);
            }
          })
          .catch((e: any) => {
            setReaderStatus('error');
            setReaderError(e?.message ?? 'Connection failed.');
          });
      }
    }, [connectLocalMobileReader]),
  });

  // Load products
  useEffect(() => {
    api.getProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  // If reader connects externally, update status
  useEffect(() => {
    if (connectedReader) {
      setReaderStatus('ready');
      setReaderError(null);
    }
  }, [connectedReader]);

  async function startDiscovery() {
    setReaderStatus('connecting');
    setReaderError(null);
    try {
      const { error: initErr } = await initialize();
      if (initErr) {
        setReaderStatus('error');
        setReaderError(initErr.message ?? 'Terminal init failed.');
        return;
      }

      // On iOS, discoverReaders with localMobile triggers Apple's ProximityReaderDiscovery
      // overlay ("How to Tap") — this is the required Apple UX step.
      const { error: discoverErr } = await discoverReaders({
        discoveryMethod: 'localMobile',
        simulated: false,
      });

      if (discoverErr) {
        setReaderStatus('error');
        // Surface entitlement issues clearly so the instructor knows what's wrong.
        const msg = discoverErr.message ?? '';
        if (msg.toLowerCase().includes('entitlement') || msg.toLowerCase().includes('not supported')) {
          setReaderError('Tap to Pay is not enabled on this device. Make sure the Apple entitlement is approved and you are on iOS 16 or later.');
        } else {
          setReaderError(msg || 'Discovery failed.');
        }
      }
    } catch (e: any) {
      setReaderStatus('error');
      setReaderError(e?.message ?? 'Unexpected error.');
    }
  }

  function showResult(success: boolean, message: string) {
    if (resultTimer.current) clearTimeout(resultTimer.current);
    setLastResult({ success, message });
    resultTimer.current = setTimeout(() => setLastResult(null), 3000);
  }

  async function chargeProduct(amount_cents: number, name: string) {
    if (readerStatus !== 'ready') {
      Alert.alert('Reader Not Ready', 'Please wait for the reader to connect before charging.');
      return;
    }
    setCharging(true);
    setLastResult(null);
    try {
      const { client_secret } = await api.createPaymentIntent(amount_cents, name);

      const { paymentIntent, error: collectErr } = await collectPaymentMethod({
        paymentIntentClientSecret: client_secret,
      });

      if (collectErr) {
        if ((collectErr as any).code !== 'Canceled') {
          showResult(false, collectErr.message ?? 'Payment cancelled.');
        }
        return;
      }

      if (!paymentIntent) {
        showResult(false, 'No payment intent returned.');
        return;
      }

      const { paymentIntent: processed, error: processErr } = await processPayment(paymentIntent);

      if (processErr) {
        showResult(false, processErr.message ?? 'Payment failed.');
        return;
      }

      if (processed?.status === 'succeeded') {
        showResult(true, `${name} — ${formatPrice(amount_cents)} charged successfully.`);
      } else {
        showResult(false, `Payment status: ${processed?.status ?? 'unknown'}`);
      }
    } catch (e: any) {
      showResult(false, e.message ?? 'Unexpected error.');
    } finally {
      setCharging(false);
    }
  }

  async function handleSignOut() {
    await api.logout();
    navigation.replace('Login');
  }

  function handleProductPress(product: Product) {
    if (product.price_cents !== null) {
      chargeProduct(product.price_cents, product.name);
    } else if (product.variants.length > 0) {
      setVariantModal({ product });
    }
  }

  function handleVariantPress(product: Product, variant: ProductVariant) {
    setVariantModal(null);
    chargeProduct(variant.price_cents, `${product.name}${variant.size ? ` (${variant.size})` : ''}${variant.color ? ` ${variant.color}` : ''}`);
  }

  const statusDotStyle = readerStatus === 'ready'
    ? styles.dotGreen
    : readerStatus === 'connecting'
    ? styles.dotYellow
    : styles.dotRed;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Kinney Karate POS</Text>
        <View style={styles.headerRight}>
          <View style={[styles.statusDot, statusDotStyle]} />
          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status banner */}
      {readerStatus === 'connecting' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Connecting to reader…</Text>
        </View>
      )}
      {readerStatus === 'error' && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={styles.bannerText}>{readerError ?? 'Reader error'}</Text>
          <TouchableOpacity onPress={startDiscovery} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {readerStatus === 'idle' && (
        <View style={[styles.banner, styles.bannerIdle]}>
          <Text style={styles.bannerText}>Reader not started</Text>
        </View>
      )}

      {/* Product grid */}
      <ScrollView contentContainerStyle={styles.grid}>
        <Text style={styles.sectionLabel}>Exams</Text>
        <View style={styles.row}>
          {FIXED_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              onPress={() => chargeProduct(item.price_cents, item.name)}
              disabled={charging || readerStatus !== 'ready'}
              activeOpacity={0.75}
            >
              <Text style={styles.cardName}>{item.name}</Text>
              <Text style={styles.cardPrice}>{formatPrice(item.price_cents)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {products.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Products</Text>
            <View style={styles.row}>
              {products.map((product) => (
                <TouchableOpacity
                  key={product.id}
                  style={styles.card}
                  onPress={() => handleProductPress(product)}
                  disabled={charging || readerStatus !== 'ready'}
                  activeOpacity={0.75}
                >
                  <Text style={styles.cardName}>{product.name}</Text>
                  {product.price_cents !== null ? (
                    <Text style={styles.cardPrice}>{formatPrice(product.price_cents)}</Text>
                  ) : (
                    <Text style={styles.cardVariantHint}>Tap to select size</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* "How to Tap" setup modal — Apple requires this instructional step before Tap to Pay */}
      <Modal visible={setupModal} transparent animationType="fade">
        <View style={styles.overlayBg}>
          <View style={styles.setupCard}>
            <Text style={styles.setupTitle}>Tap to Pay on iPhone</Text>
            <Text style={styles.setupBody}>
              This app uses your iPhone as a contactless card reader.{'\n\n'}
              When a customer is ready to pay, hold their phone or card near the top of your iPhone.
              The payment goes directly to Kinney Karate — nothing is stored on your device.
            </Text>
            <View style={styles.setupHowRow}>
              <View style={styles.setupStep}>
                <Text style={styles.setupStepNum}>1</Text>
                <Text style={styles.setupStepText}>Tap an item to charge</Text>
              </View>
              <View style={styles.setupStep}>
                <Text style={styles.setupStepNum}>2</Text>
                <Text style={styles.setupStepText}>Customer holds card or phone near top of your iPhone</Text>
              </View>
              <View style={styles.setupStep}>
                <Text style={styles.setupStepNum}>3</Text>
                <Text style={styles.setupStepText}>Payment confirmed</Text>
              </View>
            </View>
            <Text style={styles.setupNote}>
              You'll see an Apple system prompt next — this enables Tap to Pay on this device.
            </Text>
            <TouchableOpacity
              style={styles.setupBtn}
              onPress={() => {
                setSetupModal(false);
                startDiscovery();
              }}
            >
              <Text style={styles.setupBtnText}>Set Up Tap to Pay</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Charging overlay */}
      <Modal visible={charging} transparent animationType="fade">
        <View style={styles.overlayBg}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color="#1a3a5c" />
            <Text style={styles.overlayText}>Hold near top of iPhone…</Text>
            <Text style={styles.overlaySubText}>Ask the customer to tap their card or phone</Text>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => { cancelCollectPaymentMethod(); }}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Variant picker modal */}
      <Modal
        visible={variantModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setVariantModal(null)}
      >
        <View style={styles.overlayBg}>
          <View style={styles.variantCard}>
            <Text style={styles.variantTitle}>{variantModal?.product.name}</Text>
            <Text style={styles.variantSubtitle}>Select a size / option</Text>
            <FlatList
              data={variantModal?.product.variants ?? []}
              keyExtractor={(v) => String(v.id)}
              renderItem={({ item: v }) => (
                <TouchableOpacity
                  style={styles.variantRow}
                  onPress={() => variantModal && handleVariantPress(variantModal.product, v)}
                >
                  <Text style={styles.variantLabel}>
                    {[v.size, v.color].filter(Boolean).join(' · ') || 'Standard'}
                  </Text>
                  <Text style={styles.variantPrice}>{formatPrice(v.price_cents)}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setVariantModal(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Result toast */}
      {lastResult && (
        <View style={[styles.toast, lastResult.success ? styles.toastSuccess : styles.toastError]}>
          <Text style={styles.toastText}>{lastResult.message}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },

  // Header
  header: {
    backgroundColor: '#1a3a5c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  dotGreen: { backgroundColor: '#2ecc71' },
  dotYellow: { backgroundColor: '#f39c12' },
  dotRed: { backgroundColor: '#e74c3c' },
  signOutBtn: { marginLeft: 8 },
  signOutText: { color: '#a8c8e8', fontSize: 14 },

  // Banner
  banner: {
    backgroundColor: '#f39c12',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  bannerError: { backgroundColor: '#e74c3c' },
  bannerIdle: { backgroundColor: '#888' },
  bannerText: { color: '#fff', fontWeight: '600', fontSize: 14, flex: 1, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Grid
  grid: { padding: 16, paddingBottom: 100 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    minWidth: 140,
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    alignItems: 'center',
  },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1a3a5c', textAlign: 'center', marginBottom: 6 },
  cardPrice: { fontSize: 22, fontWeight: '800', color: '#c0392b' },
  cardVariantHint: { fontSize: 13, color: '#888', fontStyle: 'italic' },

  // Overlay
  overlayBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 36,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
  },
  overlayText: { fontSize: 18, fontWeight: '600', color: '#1a3a5c', marginTop: 20, marginBottom: 6, textAlign: 'center' },
  overlaySubText: { fontSize: 14, color: '#666', marginBottom: 24, textAlign: 'center' },

  // Setup modal
  setupCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 380,
  },
  setupTitle: { fontSize: 22, fontWeight: '800', color: '#1a3a5c', textAlign: 'center', marginBottom: 12 },
  setupBody: { fontSize: 15, color: '#444', lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  setupHowRow: { gap: 12, marginBottom: 20 },
  setupStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#f5f7fa',
    borderRadius: 10,
    padding: 14,
  },
  setupStepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a3a5c',
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 28,
    flexShrink: 0,
  },
  setupStepText: { fontSize: 14, color: '#333', flex: 1, lineHeight: 20 },
  setupNote: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 24,
    lineHeight: 18,
  },
  setupBtn: {
    backgroundColor: '#1a3a5c',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  setupBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  // Variant modal
  variantCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    maxHeight: '80%',
  },
  variantTitle: { fontSize: 20, fontWeight: '700', color: '#1a3a5c', marginBottom: 4 },
  variantSubtitle: { fontSize: 14, color: '#888', marginBottom: 16 },
  variantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  variantLabel: { fontSize: 16, color: '#222', fontWeight: '500' },
  variantPrice: { fontSize: 18, fontWeight: '700', color: '#c0392b' },
  separator: { height: 1, backgroundColor: '#eee' },

  // Cancel button
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    alignSelf: 'center',
  },
  cancelBtnText: { fontSize: 15, color: '#555', fontWeight: '600' },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 8,
  },
  toastSuccess: { backgroundColor: '#27ae60' },
  toastError: { backgroundColor: '#c0392b' },
  toastText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
