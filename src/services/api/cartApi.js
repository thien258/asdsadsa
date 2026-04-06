import BaseApi, { API_BASE_URL } from './baseApi.js';
import productApi from './productApi.js';

class CartApi extends BaseApi {
  // Lấy giỏ hàng
  async getCart(userId) {
    // Ưu tiên dùng endpoint /don-hang/gio-hang-dto trước vì có thể đã enrich sẵn
    try {
      const params = new URLSearchParams({ userId });
      const data = await fetch(`${API_BASE_URL}/don-hang/gio-hang-dto?${params}`).then(r => r.json());
      const cartData = Array.isArray(data) && data.length > 0 ? data[0] : { idDonHang: null, chiTiet: [] };

      // Kiểm tra xem dữ liệu đã có thông tin sản phẩm chưa
      const hasProductInfo = cartData.chiTiet.length > 0 && cartData.chiTiet[0]?.tenSanPham;

      if (!hasProductInfo && cartData.chiTiet.length > 0) {
        cartData.chiTiet = await this._enrichCartItemsWithProductDetails(cartData.chiTiet);
      }

      return cartData;
    } catch (error) {
      // Fallback to /cart/dto
      try {
        const params = new URLSearchParams({ userId });
        const res = await fetch(`${API_BASE_URL}/cart/dto?${params}`);
        if (res.ok) {
          const data = await res.json();
          const cartData = { idDonHang: data.idDonHang || null, chiTiet: data.chiTiet || [] };
          // Fetch full product details for each cart item
          if (cartData.chiTiet.length > 0) {
            cartData.chiTiet = await this._enrichCartItemsWithProductDetails(cartData.chiTiet);
          }
          return cartData;
        }
      } catch (error) {
        // Return empty cart if all endpoints fail
      }
    }

    return { idDonHang: null, chiTiet: [] };
  }

  // Helper method to enrich cart items with full product details
  async _enrichCartItemsWithProductDetails(cartItems) {
    try {
      // Fetch all brands once
      const brands = await productApi.getBrands();

      // Fetch product details for each cart item
      const enrichedItems = await Promise.all(
        cartItems.map(async (item) => {
          try {
            const product = await productApi.getProductById(item.sanPhamId);
            const brand = brands.find(b => b.idThuongHieu === product.thuongHieu?.idThuongHieu);

            return {
              ...item,
              tenSanPham: product.ten_san_pham,
              urlHinhAnh: product.url_hinh_anh,
              tenThuongHieu: brand ? { tenThuongHieu: brand.tenThuongHieu } : null,
              dungTichMl: product.dung_tich_ml,
              nongDo: product.nong_do
            };
          } catch (error) {
            console.error(`Error fetching product ${item.sanPhamId}:`, error);
            // Return item with default values if product fetch fails
            return {
              ...item,
              tenSanPham: item.tenSanPham || `Sản phẩm ID: ${item.sanPhamId}`,
              urlHinhAnh: item.urlHinhAnh || "https://placehold.co/80x80?text=No+Image",
              tenThuongHieu: null,
              dungTichMl: null,
              nongDo: null
            };
          }
        })
      );

      return enrichedItems;
    } catch (error) {
      console.error('Error enriching cart items:', error);
      return cartItems; // Return original items if enrichment fails
    }
  }

  // Thêm sản phẩm vào giỏ hàng
  async addCartItem({ userId, sanPhamId, soLuong }) {
    try {
      return await this._fetch(`${API_BASE_URL}/cart/items`, { method: 'POST', body: JSON.stringify({ userId, sanPhamId, soLuong }) });
    } catch (error) {
      console.error('Lỗi thêm sản phẩm vào giỏ hàng:', error);
      throw error;
    }
  }

  // Thêm sản phẩm pre-order vào giỏ hàng
  async addPreOrderToCart(request) {
    try {
      return await this._fetch(`${API_BASE_URL}/cart/items`, {
        method: 'POST',
        body: JSON.stringify({ ...request, isPreOrder: true })
      });
    } catch (error) {
      console.error('Lỗi thêm pre-order vào giỏ hàng:', error);
      throw error;
    }
  }

  // Xóa sản phẩm khỏi giỏ hàng
  async removeCartItem(userId, sanPhamId) {
    try {
      const params = new URLSearchParams({ userId, sanPhamId });
      return await this._fetch(`${API_BASE_URL}/cart/items?${params}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Lỗi xóa sản phẩm:', error);
      throw error;
    }
  }

  // Xóa toàn bộ giỏ hàng
  async clearCart(userId) {
    try {
      const params = new URLSearchParams({ userId });
      return await this._fetch(`${API_BASE_URL}/cart?${params}`, { method: 'DELETE' });
    } catch (error) {
      console.error('Lỗi xóa giỏ hàng:', error);
      throw error;
    }
  }

  // Cập nhật số lượng sản phẩm
  async updateCartItem(userId, sanPhamId, soLuong) {
    try {
      return await this._fetch(`${API_BASE_URL}/cart/items`, {
        method: 'PUT',
        body: JSON.stringify({ userId, sanPhamId, soLuong })
      });
    } catch (error) {
      console.error('Lỗi cập nhật sản phẩm:', error);
      throw error;
    }
  }

  // Kiểm tra tồn kho trước khi thanh toán
  async checkStockBeforeCheckout(cartItems) {
    try {
      return await this._fetch(`${API_BASE_URL}/cart/check-stock`, {
        method: 'POST',
        body: JSON.stringify({ items: cartItems })
      });
    } catch (error) {
      console.error('Lỗi kiểm tra tồn kho:', error);
      throw error;
    }
  }

  // Thanh toán giỏ hàng
  async checkoutCart(request) {
    try {
      const cartData = await this.getCart(request.userId);
      if (!cartData?.chiTiet?.length) throw new Error('Giỏ hàng trống');

      const orderData = {
        idNguoiDung: request.userId,
        tenNguoiNhan: request.tenNguoiNhan,
        diaChiGiaoHang: request.diaChiGiaoHang,
        soDienThoai: request.soDienThoai || '',
        ghiChu: request.ghiChu || '',
        phuongThucThanhToan: request.phuongThucThanhToan || 'cod',
        allowBackorder: request.allowBackorder || false, // Add backorder flag
        items: cartData.chiTiet.map(({ sanPhamId, soLuong, giaTaiThoiDiemMua }) =>
          ({ sanPhamId, soLuong, giaTaiThoiDiemMua }))
      };

      return await this._fetch(`${API_BASE_URL}/dat-hang`, {
        method: 'POST',
        body: JSON.stringify(orderData)
      });
    } catch (error) {
      console.error('Lỗi thanh toán giỏ hàng:', error);
      throw error;
    }
  }
}

const cartApi = new CartApi();
export default cartApi;
